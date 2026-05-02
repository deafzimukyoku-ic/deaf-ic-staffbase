'use client';

/**
 * 児童管理（shift-puzzle settings/children/page.tsx の忠実移植）
 * - 送迎表への反映はテナント共通マーク + この児童専用エリアの選択で完結する
 * - admin: 全 facility / manager: 自 facility のみ
 * - pickup/dropoff_areas は facility_shift_settings から取得（facility 単位）
 * - staff は employees（同 facility）を使用
 * - API fetch は Supabase client 直叩き（RLS で安全）
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/shift-compat/Button';
import Badge from '@/components/shift-compat/Badge';
import Modal from '@/components/shift-compat/Modal';
import { staffDisplayName, GRADE_LABELS } from '@/lib/shift-utils';
import { useShiftFacilityId } from '@/lib/shift-facility';
import type { GradeType } from '@/lib/constants';
import { COPAY_TIERS, COPAY_TIER_LABELS, type CopayTierConst } from '@/lib/constants';
import { isFreeOfCharge, resolveCopayCap } from '@/lib/logic/computeBilling';
import type {
  ChildRow,
  AreaLabel,
  ChildAreaEligibleStaffRow,
  Facility,
  CopayTier,
} from '@/lib/types';

interface StaffLite {
  id: string;
  last_name: string;
  first_name: string;
  name?: string;
  display_order: number | null;
  facility_id: string | null;
  is_active: boolean;
}

interface Props {
  scope: 'admin' | 'manager';
}

type EditableChild = {
  id: string;
  facility_id: string;
  name: string;
  grade_type: GradeType;
  is_active: boolean;
  parent_contact: string | null;
  home_address: string | null;
  pickup_area_labels: string[];
  dropoff_area_labels: string[];
  custom_pickup_areas: AreaLabel[];
  custom_dropoff_areas: AreaLabel[];
  eligibility: Map<string, Set<string>>;
  /* Phase 66-A: 利用料金表 算出のための属性（migration 126） */
  municipality: string | null;
  copay_tier: CopayTier;
  copay_freeform_amount: number | null;
  /** 公文代の月額（円、自然数）。null = 計上しない */
  kumon_monthly_fee: number | null;
  isNew?: boolean;
};

const eligKey = (areaId: string, direction: 'pickup' | 'dropoff') =>
  `${areaId}|${direction}`;

function getGradeRowBg(grade: GradeType): string {
  switch (grade) {
    case 'preschool':
      return 'rgba(26,62,184,0.12)';
    case 'nursery_3':
    case 'nursery_4':
    case 'nursery_5':
      return 'rgba(155,51,51,0.12)';
    default:
      return 'rgba(42,122,82,0.12)';
  }
}

const formatAreaLabel = (a: AreaLabel): string => `${a.emoji} ${a.name}`;

const filterValidLabels = (labels: string[] | null | undefined, areas: AreaLabel[]): string[] => {
  if (!Array.isArray(labels) || labels.length === 0) return [];
  const ids = new Set(areas.map((a) => a.id));
  return labels.filter((id) => ids.has(id));
};

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChildrenSettingsFull({ scope }: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [me, setMe] = useState<{ id: string; tenant_id: string; facility_id: string | null } | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [children, setChildren] = useState<ChildRow[]>([]);
  // facility ごとの pickup/dropoff_area_labels
  const [facilityAreas, setFacilityAreas] = useState<Record<string, { pickup: AreaLabel[]; dropoff: AreaLabel[] }>>({});
  const [staffList, setStaffList] = useState<StaffLite[]>([]);
  const [editing, setEditing] = useState<EditableChild | null>(null);
  const [draggingChildIdx, setDraggingChildIdx] = useState<number | null>(null);
  const [dragOverChildIdx, setDragOverChildIdx] = useState<number | null>(null);

  // 上部ヘッダー共通の facility 選択（admin 用）
  const [shiftFacilityId] = useShiftFacilityId();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('ログインが必要です');

      const { data: meRow, error: meErr } = await supabase
        .from('employees')
        .select('id, tenant_id, facility_id')
        .eq('auth_user_id', user.id)
        .single();
      if (meErr || !meRow) throw new Error('ユーザー情報の取得に失敗しました');
      setMe(meRow);

      const tid = meRow.tenant_id;

      const { data: facData } = await supabase
        .from('facilities')
        .select('id, tenant_id, name, address, created_at')
        .eq('tenant_id', tid)
        .order('created_at');
      const allFacs = (facData as Facility[]) || [];
      const scopedFacs =
        scope === 'manager' && meRow.facility_id
          ? allFacs.filter((f) => f.id === meRow.facility_id)
          : allFacs;
      setFacilities(scopedFacs);

      // children（RLS で自動スコープ。admin は全 facility、manager は自facility）
      const { data: childData } = await supabase
        .from('children')
        .select('*')
        .eq('tenant_id', tid)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      setChildren((childData as ChildRow[]) || []);

      // facility_shift_settings（各facilityの pickup/dropoff_area_labels）
      const { data: fsRows } = await supabase
        .from('facility_shift_settings')
        .select('facility_id, pickup_area_labels, dropoff_area_labels')
        .eq('tenant_id', tid);
      const areaMap: Record<string, { pickup: AreaLabel[]; dropoff: AreaLabel[] }> = {};
      for (const r of (fsRows ?? []) as { facility_id: string; pickup_area_labels: AreaLabel[]; dropoff_area_labels: AreaLabel[] }[]) {
        areaMap[r.facility_id] = {
          pickup: Array.isArray(r.pickup_area_labels) ? r.pickup_area_labels : [],
          dropoff: Array.isArray(r.dropoff_area_labels) ? r.dropoff_area_labels : [],
        };
      }
      setFacilityAreas(areaMap);

      // 在職職員（eligibility 用）
      const { data: staffRows } = await supabase
        .from('employees')
        .select('id, last_name, first_name, display_order, facility_id, status')
        .eq('tenant_id', tid)
        .eq('status', 'active')
        .neq('role', 'admin');
      setStaffList(
        ((staffRows ?? []) as { id: string; last_name: string; first_name: string; display_order: number | null; facility_id: string | null; status: string }[]).map((s) => ({
          id: s.id,
          last_name: s.last_name,
          first_name: s.first_name,
          display_order: s.display_order,
          facility_id: s.facility_id,
          is_active: s.status === 'active',
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [supabase, scope]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // /?child=<id> で来た場合、対象児童を自動で編集モーダルに開く
  useEffect(() => {
    if (loading || children.length === 0) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const childParam = params.get('child');
    if (!childParam || editing) return;
    const target = children.find((c) => c.id === childParam);
    if (target) handleEdit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, children]);

  const handleAdd = () => {
    const defaultFacilityId =
      scope === 'manager' && me?.facility_id
        ? me.facility_id
        : (shiftFacilityId ?? facilities[0]?.id ?? '');
    if (!defaultFacilityId) {
      setError('事業所が登録されていません。先に事業所設定を行ってください。');
      return;
    }
    setEditing({
      id: `new-${Date.now()}`,
      facility_id: defaultFacilityId,
      name: '',
      grade_type: 'elementary_1',
      is_active: true,
      parent_contact: null,
      home_address: null,
      pickup_area_labels: [],
      dropoff_area_labels: [],
      custom_pickup_areas: [],
      custom_dropoff_areas: [],
      eligibility: new Map(),
      municipality: null,
      copay_tier: 'zero',
      copay_freeform_amount: null,
      kumon_monthly_fee: null,
      isNew: true,
    });
  };

  const handleEdit = async (child: ChildRow) => {
    let eligibility = new Map<string, Set<string>>();
    try {
      const { data: items } = await supabase
        .from('child_area_eligible_staff')
        .select('*')
        .eq('child_id', child.id);
      for (const it of ((items ?? []) as ChildAreaEligibleStaffRow[])) {
        const k = eligKey(it.area_id, it.direction);
        if (!eligibility.has(k)) eligibility.set(k, new Set());
        eligibility.get(k)!.add(it.employee_id);
      }
    } catch {
      eligibility = new Map();
    }
    setEditing({
      id: child.id,
      facility_id: child.facility_id,
      name: child.name,
      grade_type: child.grade_type,
      is_active: child.is_active,
      parent_contact: child.parent_contact,
      home_address: child.home_address,
      pickup_area_labels: child.pickup_area_labels ?? [],
      dropoff_area_labels: child.dropoff_area_labels ?? [],
      custom_pickup_areas: Array.isArray(child.custom_pickup_areas) ? child.custom_pickup_areas : [],
      custom_dropoff_areas: Array.isArray(child.custom_dropoff_areas) ? child.custom_dropoff_areas : [],
      eligibility,
      municipality: child.municipality ?? null,
      copay_tier: (child.copay_tier ?? 'zero') as CopayTier,
      copay_freeform_amount: child.copay_freeform_amount ?? null,
      kumon_monthly_fee: child.kumon_monthly_fee ?? null,
    });
  };

  const handleSave = async () => {
    if (!editing || !editing.name || !me) return;
    setSaving(true);
    setError('');
    try {
      /* Phase 66-A: copay_freeform_amount は freeform 階層のときのみ送信、それ以外は強制 null（DB CHECK 整合）。 */
      const freeformAmt = editing.copay_tier === 'freeform' ? editing.copay_freeform_amount : null;
      const payload = {
        tenant_id: me.tenant_id,
        facility_id: editing.facility_id,
        name: editing.name,
        grade_type: editing.grade_type,
        is_active: editing.is_active,
        parent_contact: editing.parent_contact,
        home_address: editing.home_address,
        pickup_area_labels: editing.pickup_area_labels,
        dropoff_area_labels: editing.dropoff_area_labels,
        custom_pickup_areas: editing.custom_pickup_areas,
        custom_dropoff_areas: editing.custom_dropoff_areas,
        municipality: editing.municipality && editing.municipality.trim() !== '' ? editing.municipality.trim() : null,
        copay_tier: editing.copay_tier,
        copay_freeform_amount: freeformAmt,
        kumon_monthly_fee:
          editing.kumon_monthly_fee != null && editing.kumon_monthly_fee > 0
            ? Math.floor(editing.kumon_monthly_fee)
            : null,
      };
      let targetId = editing.id;
      if (editing.isNew) {
        // 新規作成時は display_order を末尾に
        const maxOrder = Math.max(-1, ...children.filter((c) => c.facility_id === editing.facility_id).map((c) => c.display_order ?? -1));
        const { data: inserted, error: insErr } = await supabase
          .from('children')
          .insert({ ...payload, display_order: maxOrder + 1 })
          .select('id')
          .single();
        if (insErr) throw new Error(insErr.message);
        targetId = (inserted as { id: string }).id;
      } else {
        const { error: updErr } = await supabase
          .from('children')
          .update(payload)
          .eq('id', editing.id);
        if (updErr) throw new Error(updErr.message);
      }

      // child_area_eligible_staff を全置換。
      // 児童専用エリア（custom_*_areas）の id に紐づくもののみ送信し、削除されたエリアに紐づくレコードは除外。
      const validAreaIds = new Set([
        ...editing.custom_pickup_areas.map((a) => a.id),
        ...editing.custom_dropoff_areas.map((a) => a.id),
      ]);
      const items: { tenant_id: string; facility_id: string; child_id: string; area_id: string; employee_id: string; direction: 'pickup' | 'dropoff' }[] = [];
      for (const [k, set] of editing.eligibility) {
        const [areaId, dir] = k.split('|') as [string, 'pickup' | 'dropoff'];
        if (!validAreaIds.has(areaId)) continue;
        for (const employeeId of set) {
          items.push({
            tenant_id: me.tenant_id,
            facility_id: editing.facility_id,
            child_id: targetId,
            area_id: areaId,
            employee_id: employeeId,
            direction: dir,
          });
        }
      }
      // 既存削除
      const { error: delErr } = await supabase
        .from('child_area_eligible_staff')
        .delete()
        .eq('child_id', targetId);
      if (delErr) throw new Error(delErr.message);
      // 新規挿入
      if (items.length > 0) {
        const { error: insEErr } = await supabase
          .from('child_area_eligible_staff')
          .insert(items);
        if (insEErr) throw new Error(insEErr.message);
      }

      setEditing(null);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing || editing.isNew) return;
    if (!confirm(`${editing.name} を削除しますか？`)) return;
    setSaving(true);
    try {
      const { error: delErr } = await supabase.from('children').delete().eq('id', editing.id);
      if (delErr) throw new Error(delErr.message);
      setEditing(null);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleReorderChildren = async (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= visibleChildren.length || to >= visibleChildren.length) return;
    const next = [...visibleChildren];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    // 楽観更新: visibleChildren の順序を反映して children 全体を更新
    const idMap = new Map(next.map((c, idx) => [c.id, idx]));
    const merged = [...children].sort((a, b) => {
      const ao = idMap.get(a.id);
      const bo = idMap.get(b.id);
      if (ao === undefined && bo === undefined) return 0;
      if (ao === undefined) return 1;
      if (bo === undefined) return -1;
      return ao - bo;
    });
    setChildren(merged);

    // 表示中の children の display_order を 0,1,2... で採番
    try {
      for (let i = 0; i < next.length; i++) {
        const { error: upErr } = await supabase
          .from('children')
          .update({ display_order: i })
          .eq('id', next[i].id);
        if (upErr) throw new Error(upErr.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '並び替えに失敗しました');
      await fetchAll();
    }
  };

  // 表示対象。manager は全件（自 facility のみが RLS で返る）
  // admin は上部ヘッダーで選択中の facility のみ表示
  const visibleChildren = useMemo(() => {
    if (scope === 'manager') return children;
    if (!shiftFacilityId) return children;
    return children.filter((c) => c.facility_id === shiftFacilityId);
  }, [children, shiftFacilityId, scope]);

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)',
    color: 'var(--ink)',
    border: '1px solid var(--rule)',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '0.85rem',
  };

  if (loading) {
    return <div className="p-6" style={{ color: 'var(--ink-3)' }}>読み込み中...</div>;
  }

  const activeCount = visibleChildren.filter((c) => c.is_active).length;
  const facilityMap = new Map(facilities.map((f) => [f.id, f]));

  // 編集中児童の facility に応じた pickup/dropoff エリア
  const editingPickupAreas: AreaLabel[] = editing ? (facilityAreas[editing.facility_id]?.pickup ?? []) : [];
  const editingDropoffAreas: AreaLabel[] = editing ? (facilityAreas[editing.facility_id]?.dropoff ?? []) : [];
  // 編集中児童の facility に所属する職員のみ表示
  const editingStaffList = editing ? staffList.filter((s) => s.facility_id === editing.facility_id) : [];

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Badge variant="info">{activeCount}名（在籍）</Badge>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={scope === 'admin' ? '/admin/shifts/facility-settings' : '/mgr/shifts/facility-settings'}
            className="text-xs font-medium transition-colors inline-flex items-center gap-1 px-3 py-2 rounded-md hover:bg-[var(--accent-pale)]"
            style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}
            title="送迎エリアの追加・並び替え・時間・住所を設定"
          >
            送迎エリアを設定 →
          </a>
          <Button variant="primary" onClick={handleAdd}>+ 児童追加</Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2 rounded" style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* md 以上: テーブル */}
      <div className="hidden md:block overflow-x-auto" style={{ borderRadius: '8px', border: '1px solid var(--rule)' }}>
        <table className="w-full border-collapse" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th
                className="px-2 py-2 text-center font-semibold"
                style={{ background: 'var(--ink)', color: '#fff', width: '36px' }}
                title="ドラッグで並び替え"
              >
                ↕
              </th>
              {['氏名', '学年', '上限', '公文', '迎マーク', '送マーク', '専用エリア', 'ステータス'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold" style={{ background: 'var(--ink)', color: '#fff' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleChildren.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center" style={{ color: 'var(--ink-3)' }}>
                  児童が登録されていません
                </td>
              </tr>
            )}
            {visibleChildren.map((c, idx) => {
              const facAreas = facilityAreas[c.facility_id] ?? { pickup: [], dropoff: [] };
              const childPickupAreas = [...facAreas.pickup, ...(c.custom_pickup_areas ?? [])];
              const childDropoffAreas = [...facAreas.dropoff, ...(c.custom_dropoff_areas ?? [])];
              const pickupCount = filterValidLabels(c.pickup_area_labels, childPickupAreas).length;
              const dropoffCount = filterValidLabels(c.dropoff_area_labels, childDropoffAreas).length;
              const isDragging = draggingChildIdx === idx;
              const isDropTarget = dragOverChildIdx === idx && draggingChildIdx !== null && draggingChildIdx !== idx;
              return (
                <tr
                  key={c.id}
                  onDragOver={(e) => {
                    if (draggingChildIdx === null || draggingChildIdx === idx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverChildIdx(idx);
                  }}
                  onDragLeave={() => {
                    if (dragOverChildIdx === idx) setDragOverChildIdx(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingChildIdx !== null && draggingChildIdx !== idx) {
                      handleReorderChildren(draggingChildIdx, idx);
                    }
                    setDraggingChildIdx(null);
                    setDragOverChildIdx(null);
                  }}
                  className="hover:bg-[var(--accent-pale)] cursor-pointer transition-colors"
                  style={{
                    opacity: isDragging ? 0.4 : 1,
                    background: isDropTarget
                      ? 'var(--accent-pale)'
                      : idx % 2 === 1
                        ? `linear-gradient(rgba(0,0,0,0.028), rgba(0,0,0,0.028)), ${getGradeRowBg(c.grade_type)}`
                        : getGradeRowBg(c.grade_type),
                  }}
                  onClick={() => handleEdit(c)}
                >
                  <td
                    className="px-1 py-2 text-center"
                    style={{ borderBottom: '1px solid var(--rule)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      draggable
                      onDragStart={(e) => {
                        setDraggingChildIdx(idx);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(idx));
                      }}
                      onDragEnd={() => {
                        setDraggingChildIdx(null);
                        setDragOverChildIdx(null);
                      }}
                      className="inline-flex items-center justify-center w-6 h-7 rounded transition-colors hover:bg-[var(--bg)]"
                      style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                      aria-label="ドラッグして並び替え"
                      title="ドラッグして並び替え"
                    >
                      <svg width="14" height="18" viewBox="0 0 14 18" fill="var(--ink-3)" aria-hidden>
                        <circle cx="4" cy="4" r="1.3" />
                        <circle cx="10" cy="4" r="1.3" />
                        <circle cx="4" cy="9" r="1.3" />
                        <circle cx="10" cy="9" r="1.3" />
                        <circle cx="4" cy="14" r="1.3" />
                        <circle cx="10" cy="14" r="1.3" />
                      </svg>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-medium" style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink)' }}>{c.name}</td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)' }}>
                    <Badge variant="info">{GRADE_LABELS[c.grade_type]}</Badge>
                  </td>
                  {/* 上限負担額（無償化判定込み）*/}
                  <td className="px-3 py-2 whitespace-nowrap" style={{ borderBottom: '1px solid var(--rule)', fontVariantNumeric: 'tabular-nums' }}>
                    {(() => {
                      const free = isFreeOfCharge(c.grade_type, c.municipality ?? null);
                      if (free) {
                        return (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold"
                            style={{ background: 'var(--accent-pale)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                            title="無償化対象（年少/年中/年長 または 名古屋市の preschool）"
                          >
                            無償化
                          </span>
                        );
                      }
                      const tier = (c.copay_tier ?? 'zero') as CopayTier;
                      const cap = resolveCopayCap({ copayTier: tier, copayFreeformAmount: c.copay_freeform_amount ?? null });
                      if (cap == null || cap <= 0) {
                        return <span style={{ color: 'var(--ink-3)' }}>¥0</span>;
                      }
                      return (
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                          ¥{cap.toLocaleString('ja-JP')}
                        </span>
                      );
                    })()}
                  </td>
                  {/* 公文代 */}
                  <td className="px-3 py-2 whitespace-nowrap" style={{ borderBottom: '1px solid var(--rule)', fontVariantNumeric: 'tabular-nums' }}>
                    {c.kumon_monthly_fee != null && c.kumon_monthly_fee > 0 ? (
                      <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                        ¥{c.kumon_monthly_fee.toLocaleString('ja-JP')}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)', color: pickupCount > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>
                    {pickupCount === 0 ? '—' : `${pickupCount}件`}
                  </td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)', color: dropoffCount > 0 ? 'var(--green)' : 'var(--ink-3)' }}>
                    {dropoffCount === 0 ? '—' : `${dropoffCount}件`}
                  </td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)' }}>
                    {(() => {
                      const customAreas = [
                        ...(c.custom_pickup_areas ?? []),
                        ...(c.custom_dropoff_areas ?? []),
                      ];
                      if (customAreas.length === 0) {
                        return <span style={{ color: 'var(--ink-3)' }}>—</span>;
                      }
                      const shown = customAreas.slice(0, 3);
                      const rest = customAreas.length - shown.length;
                      return (
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
                          <span style={{ fontSize: '1rem', letterSpacing: '-0.02em' }}>
                            {shown.map((a) => a.emoji).join('')}
                          </span>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                            {customAreas.length}件
                            {rest > 0 && (<span style={{ color: 'var(--ink-3)' }}> (+{rest})</span>)}
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)' }}>
                    <Badge variant={c.is_active ? 'success' : 'neutral'}>{c.is_active ? '在籍' : '退籍'}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* md 未満: カード一覧 */}
      <ul className="md:hidden flex flex-col gap-2">
        {visibleChildren.length === 0 && (
          <li
            className="rounded-md p-4 text-center text-sm"
            style={{ background: 'var(--white)', border: '1px solid var(--rule)', color: 'var(--ink-3)' }}
          >
            児童が登録されていません
          </li>
        )}
        {visibleChildren.map((c, idx) => {
          const facAreas = facilityAreas[c.facility_id] ?? { pickup: [], dropoff: [] };
          const childPickupAreas = [...facAreas.pickup, ...(c.custom_pickup_areas ?? [])];
          const childDropoffAreas = [...facAreas.dropoff, ...(c.custom_dropoff_areas ?? [])];
          const pickupCount = filterValidLabels(c.pickup_area_labels, childPickupAreas).length;
          const dropoffCount = filterValidLabels(c.dropoff_area_labels, childDropoffAreas).length;
          const free = isFreeOfCharge(c.grade_type, c.municipality ?? null);
          const tier = (c.copay_tier ?? 'zero') as CopayTier;
          const cap = resolveCopayCap({ copayTier: tier, copayFreeformAmount: c.copay_freeform_amount ?? null });
          return (
            <li key={c.id}>
              <div
                onClick={() => handleEdit(c)}
                className="rounded-md p-3 transition-colors active:bg-[var(--accent-pale)] cursor-pointer"
                style={{
                  background: getGradeRowBg(c.grade_type),
                  border: '1px solid var(--rule)',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-sm truncate" style={{ color: 'var(--ink)' }}>{c.name}</span>
                    <Badge variant="info">{GRADE_LABELS[c.grade_type]}</Badge>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => idx > 0 && handleReorderChildren(idx, idx - 1)}
                      disabled={idx === 0}
                      className="px-2 py-1 rounded text-xs font-bold disabled:opacity-30"
                      style={{ border: '1px solid var(--rule)', background: 'var(--white)' }}
                      aria-label="上へ移動"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => idx < visibleChildren.length - 1 && handleReorderChildren(idx, idx + 1)}
                      disabled={idx === visibleChildren.length - 1}
                      className="px-2 py-1 rounded text-xs font-bold disabled:opacity-30"
                      style={{ border: '1px solid var(--rule)', background: 'var(--white)' }}
                      aria-label="下へ移動"
                    >
                      ↓
                    </button>
                    <Badge variant={c.is_active ? 'success' : 'neutral'}>{c.is_active ? '在籍' : '退籍'}</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--ink-3)' }}>上限</span>
                    <span className="tabular-nums">
                      {free ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'var(--accent-pale)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>無償化</span>
                      ) : cap == null || cap <= 0 ? (
                        <span style={{ color: 'var(--ink-3)' }}>¥0</span>
                      ) : (
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>¥{cap.toLocaleString('ja-JP')}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--ink-3)' }}>公文</span>
                    <span className="tabular-nums">
                      {c.kumon_monthly_fee != null && c.kumon_monthly_fee > 0
                        ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>¥{c.kumon_monthly_fee.toLocaleString('ja-JP')}</span>
                        : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--ink-3)' }}>迎マーク</span>
                    <span style={{ color: pickupCount > 0 ? 'var(--accent)' : 'var(--ink-3)' }}>
                      {pickupCount === 0 ? '—' : `${pickupCount}件`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--ink-3)' }}>送マーク</span>
                    <span style={{ color: dropoffCount > 0 ? 'var(--green)' : 'var(--ink-3)' }}>
                      {dropoffCount === 0 ? '—' : `${dropoffCount}件`}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.isNew ? '児童追加' : `${editing?.name} の設定`}
        size="lg"
      >
        {editing && (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              {/* 事業所選択（admin で複数facility持つ場合のみ） */}
              {scope === 'admin' && facilities.length > 1 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>所属事業所 *</label>
                  <select
                    value={editing.facility_id}
                    onChange={(e) => setEditing({ ...editing, facility_id: e.target.value, pickup_area_labels: [], dropoff_area_labels: [], eligibility: new Map() })}
                    className="outline-none"
                    style={inputStyle}
                  >
                    {facilities.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                  </select>
                  {!editing.isNew && (
                    <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                      事業所を変更するとエリア選択・担当可能職員はリセットされます
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>氏名</label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="outline-none"
                    style={inputStyle}
                    placeholder="例）山田 太郎"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>学年</label>
                  <select
                    value={editing.grade_type}
                    onChange={(e) => setEditing({ ...editing, grade_type: e.target.value as GradeType })}
                    className="outline-none"
                    style={inputStyle}
                  >
                    {/* junior_high (中学旧) は中1/中2/中3 への分割前の旧データ用。
                       新規入力では選ばせない。既存データに残っていても表示は GRADE_LABELS で行える。 */}
                    {Object.entries(GRADE_LABELS)
                      .filter(([k]) => k !== 'junior_high')
                      .map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>保護者連絡先（任意）</label>
                  <input
                    type="text"
                    value={editing.parent_contact ?? ''}
                    onChange={(e) => setEditing({ ...editing, parent_contact: e.target.value })}
                    className="outline-none"
                    style={inputStyle}
                    placeholder="090-xxxx-xxxx"
                  />
                </div>
                <label
                  className="flex items-center justify-center gap-2 rounded cursor-pointer"
                  style={{
                    background: editing.is_active ? 'var(--green-pale)' : 'var(--bg)',
                    border: `1px solid ${editing.is_active ? 'rgba(42,122,82,0.25)' : 'var(--rule)'}`,
                    padding: '0 12px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editing.is_active}
                    onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                  />
                  <span className="text-sm font-medium" style={{ color: editing.is_active ? 'var(--green)' : 'var(--ink-3)' }}>
                    {editing.is_active ? '在籍' : '退籍'}
                  </span>
                </label>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                  自宅住所（送り先のデフォルト）
                </label>
                <input
                  type="text"
                  value={editing.home_address ?? ''}
                  onChange={(e) => setEditing({ ...editing, home_address: e.target.value })}
                  className="outline-none"
                  style={inputStyle}
                  placeholder="例）〇〇県〇〇市〇〇町1-2-3"
                />
                <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                  送りマークに住所が未設定の場合、ここが自動で使われます（送迎表 → 地図で開く）
                </p>
              </div>

              {/* Phase 66-A: 利用料金表 用の児童属性（migration 126）— 色分けで他フィールドと差別化 */}
              <div
                className="flex flex-col gap-3 p-4 rounded-lg"
                style={{
                  background: 'var(--gold-pale)',
                  border: '2px solid var(--gold)',
                  boxShadow: '0 1px 3px rgba(138,97,32,0.12)',
                }}
              >
                <div
                  className="flex items-center gap-2 pb-2"
                  style={{ borderBottom: '1.5px solid rgba(138,97,32,0.25)' }}
                >
                  <span style={{ fontSize: '1.25rem' }}>💰</span>
                  <span className="text-sm font-black" style={{ color: 'var(--gold)' }}>
                    利用料金表 用の設定
                  </span>
                </div>

                {/* 市町村 — 青系（accent） */}
                <div
                  className="flex flex-col gap-1.5 p-3 rounded"
                  style={{ background: 'var(--white)', borderLeft: '3px solid var(--accent)' }}
                >
                  <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                    🏙 市町村
                    <span className="text-[10px] font-normal" style={{ color: 'var(--ink-3)' }}>
                      （利用料金表「市町村」列に出力）
                    </span>
                  </label>
                  <input
                    type="text"
                    value={editing.municipality ?? ''}
                    onChange={(e) => setEditing({ ...editing, municipality: e.target.value })}
                    className="outline-none"
                    style={inputStyle}
                    placeholder="例）半田市 / 名古屋市"
                  />
                  <p className="text-[11px]" style={{ color: 'var(--accent)', fontWeight: 500 }}>
                    💡 名古屋市の場合は未就学（preschool）も自動で無償化対象になります
                  </p>
                </div>

                {/* 利用者上限負担額 — 緑系（green） */}
                <div
                  className="flex flex-col gap-1.5 p-3 rounded"
                  style={{ background: 'var(--white)', borderLeft: '3px solid var(--green)' }}
                >
                  <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--green)' }}>
                    💴 利用者上限負担額
                  </label>
                  <select
                    value={editing.copay_tier}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        copay_tier: e.target.value as CopayTier,
                        copay_freeform_amount:
                          (e.target.value as CopayTier) === 'freeform'
                            ? editing.copay_freeform_amount
                            : null,
                      })
                    }
                    className="outline-none font-semibold"
                    style={{ ...inputStyle, color: 'var(--ink)' }}
                  >
                    {COPAY_TIERS.map((t) => (
                      <option key={t} value={t}>
                        {COPAY_TIER_LABELS[t as CopayTierConst]}
                      </option>
                    ))}
                  </select>
                  {editing.copay_tier === 'freeform' && (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editing.copay_freeform_amount != null
                        ? `¥${editing.copay_freeform_amount.toLocaleString('ja-JP')}`
                        : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d]/g, '');
                        const n = raw === '' ? null : Math.max(1, parseInt(raw, 10));
                        setEditing({ ...editing, copay_freeform_amount: n });
                      }}
                      className="outline-none mt-1 font-semibold"
                      style={{ ...inputStyle, color: 'var(--green)' }}
                      placeholder="例）¥21,000"
                    />
                  )}
                  <p className="text-[11px]" style={{ color: 'var(--green)', fontWeight: 500 }}>
                    💡 年少 / 年中 / 年長は学年で自動的に無償化対象（&quot;—&quot;表示）になります
                  </p>
                </div>

                {/* 公文代 — 赤系（red） */}
                <div
                  className="flex flex-col gap-1.5 p-3 rounded"
                  style={{ background: 'var(--white)', borderLeft: '3px solid var(--red)' }}
                >
                  <label className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--red)' }}>
                    ✏️ 公文代（教材印刷代）月額
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editing.kumon_monthly_fee != null
                      ? `¥${editing.kumon_monthly_fee.toLocaleString('ja-JP')}`
                      : ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '');
                      const n = raw === '' ? null : Math.max(0, parseInt(raw, 10));
                      setEditing({
                        ...editing,
                        kumon_monthly_fee: n != null && n > 0 ? n : null,
                      });
                    }}
                    className="outline-none font-semibold"
                    style={{ ...inputStyle, color: 'var(--ink)' }}
                    placeholder="例）¥2,000 ／ 空欄=計上しない"
                  />
                  <p className="text-[11px]" style={{ color: 'var(--red)', fontWeight: 500 }}>
                    💡 施設・児童ごとに金額が違うため自由入力。空欄なら料金表の「公文代」列は空白
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <a
                  href={scope === 'admin' ? '/admin/shifts/facility-settings' : '/mgr/shifts/facility-settings'}
                  target="_blank"
                  rel="noopener"
                  className="text-xs"
                  style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                >
                  事業所設定で追加 →
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['pickup', 'dropoff'] as const).map((direction) => {
                  const key = direction === 'pickup' ? 'pickup_area_labels' : 'dropoff_area_labels';
                  const customKey = direction === 'pickup' ? 'custom_pickup_areas' : 'custom_dropoff_areas';
                  const label = direction === 'pickup' ? 'お迎えマーク' : 'お送りマーク';
                  const accentVar = direction === 'pickup' ? 'var(--accent)' : 'var(--green)';
                  const palVar = direction === 'pickup' ? 'var(--accent-pale)' : 'var(--green-pale)';
                  const tenantAreasDir = direction === 'pickup' ? editingPickupAreas : editingDropoffAreas;
                  const customAreas = editing[customKey];
                  const selected = editing[key];
                  type AreaRow = { area: AreaLabel; source: 'tenant' | 'custom'; label: string };
                  const merged: AreaRow[] = [];
                  const seenIds = new Set<string>();
                  for (const a of tenantAreasDir) {
                    seenIds.add(a.id);
                    const override = customAreas.find((c) => c.id === a.id);
                    merged.push(
                      override
                        ? { area: override, source: 'custom', label: formatAreaLabel(override) }
                        : { area: a, source: 'tenant', label: formatAreaLabel(a) },
                    );
                  }
                  for (const c of customAreas) {
                    if (seenIds.has(c.id)) continue;
                    merged.push({ area: c, source: 'custom', label: formatAreaLabel(c) });
                  }
                  const allIds = merged.map((r) => r.area.id);
                  return (
                    <div
                      key={direction}
                      className="flex flex-col gap-1.5 rounded-md p-2"
                      style={{ border: '1px solid var(--rule)', background: palVar }}
                    >
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold" style={{ color: accentVar }}>{label}</label>
                        {merged.length > 0 && (
                          <div className="flex items-center gap-2 text-xs">
                            <button type="button" onClick={() => setEditing({ ...editing, [key]: allIds })} style={{ color: accentVar, textDecoration: 'underline' }}>全選択</button>
                            <span style={{ color: 'var(--ink-3)' }}>/</span>
                            <button type="button" onClick={() => setEditing({ ...editing, [key]: [] })} style={{ color: 'var(--ink-3)', textDecoration: 'underline' }}>全解除</button>
                          </div>
                        )}
                      </div>
                      {merged.length === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                          （事業所設定または下の「この児童専用エリア」で{label.replace('マーク', '')}エリアを追加してください）
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {(['tenant', 'custom'] as const).map((src) => {
                            const rows = merged.filter((r) => r.source === src);
                            if (rows.length === 0) return null;
                            return (
                              <div key={src} className="flex flex-col gap-1">
                                <span className="text-[10px] font-semibold" style={{ color: 'var(--ink-3)' }}>
                                  {src === 'tenant' ? '【事業所共通】' : '【この児童専用】'}
                                </span>
                                {rows.map(({ area: a, label: ll }, idx) => {
                                  const checked = selected.includes(a.id);
                                  const zebraBg = idx % 2 === 1 ? 'rgba(0,0,0,0.035)' : 'var(--white)';
                                  return (
                                    <button
                                      type="button"
                                      key={`${src}-${idx}-${a.id}`}
                                      onClick={() => {
                                        const next = checked ? selected.filter((id) => id !== a.id) : [...selected, a.id];
                                        setEditing({ ...editing, [key]: next });
                                      }}
                                      className="rounded-md transition-all text-left"
                                      style={{
                                        padding: '5px 10px',
                                        fontSize: '0.78rem',
                                        fontWeight: 500,
                                        background: checked ? accentVar : zebraBg,
                                        color: checked ? '#fff' : 'var(--ink-2)',
                                        border: `1px solid ${checked ? accentVar : 'var(--rule)'}`,
                                      }}
                                      title={a.time ? `${ll}：${a.time}〜` : ll}
                                    >
                                      {checked ? '✓ ' : ''}
                                      {ll}
                                      {a.time && (
                                        <span className="ml-1.5 opacity-80" style={{ fontSize: '0.7rem' }}>
                                          {a.time}
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <CustomAreasEditor
                editing={editing}
                setEditing={setEditing}
                inputStyle={inputStyle}
                staffList={editingStaffList}
              />
            </section>

            <div className="flex justify-between gap-2 mt-2">
              <div>
                {!editing.isNew && (
                  <Button variant="secondary" onClick={handleDelete} disabled={saving}>
                    <span style={{ color: 'var(--red)' }}>削除</span>
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>キャンセル</Button>
                <Button variant="primary" onClick={handleSave} disabled={!editing.name || saving}>
                  {saving ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * 児童専用エリアの編集 UI + エリアごとの担当可能職員トグル。
 */
function CustomAreasEditor({
  editing,
  setEditing,
  inputStyle,
  staffList,
}: {
  editing: EditableChild;
  setEditing: (c: EditableChild) => void;
  inputStyle: React.CSSProperties;
  staffList: StaffLite[];
}) {
  const sections = [
    { key: 'custom_pickup_areas' as const, title: 'お迎え（この児童専用）', accent: 'var(--accent)', pale: 'var(--accent-pale)' },
    { key: 'custom_dropoff_areas' as const, title: 'お送り（この児童専用）', accent: 'var(--green)', pale: 'var(--green-pale)' },
  ];

  const updateArea = (
    key: 'custom_pickup_areas' | 'custom_dropoff_areas',
    i: number,
    field: keyof AreaLabel,
    value: string,
  ) => {
    const next = editing[key].map((a, idx) => (idx === i ? { ...a, [field]: value } : a));
    setEditing({ ...editing, [key]: next });
  };
  const addArea = (key: 'custom_pickup_areas' | 'custom_dropoff_areas') => {
    setEditing({ ...editing, [key]: [...editing[key], { id: genId(), emoji: '🏠', name: '' }] });
  };
  const removeArea = (key: 'custom_pickup_areas' | 'custom_dropoff_areas', i: number) => {
    setEditing({ ...editing, [key]: editing[key].filter((_, idx) => idx !== i) });
  };

  const emojiStyle: React.CSSProperties = { ...inputStyle, width: '2.75rem', textAlign: 'center', padding: '6px 4px', fontSize: '1rem' };
  const nameStyle: React.CSSProperties = { ...inputStyle, padding: '6px 10px' };
  const timeStyle: React.CSSProperties = { ...inputStyle, width: '6rem', padding: '6px 8px', fontVariantNumeric: 'tabular-nums' };
  const addrStyle: React.CSSProperties = { ...inputStyle, padding: '6px 10px', flex: 1 };

  return (
    <div
      className="flex flex-col gap-2 rounded-md p-3 mt-1"
      style={{ border: '1px dashed var(--rule-strong)', background: 'var(--bg)' }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
          この児童専用エリア（イレギュラー用）
        </span>
        <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
          事業所共通マークでは表現できない時刻・場所をここに追加できます。追加したマークは上の「お迎え / お送りマーク」の【この児童専用】に並び、選択するとこの児童の送迎表だけに反映されます。
        </span>
      </div>

      {sections.map(({ key, title, accent, pale }) => (
        <div key={key} className="flex flex-col gap-1.5 rounded-md p-2" style={{ border: '1px solid var(--rule)', background: pale }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: accent }}>{title}</span>
            <button
              type="button"
              onClick={() => addArea(key)}
              className="text-xs px-2 py-1 rounded"
              style={{ color: accent, border: `1px solid ${accent}`, background: 'var(--white)' }}
            >
              ＋ 追加
            </button>
          </div>
          {editing[key].length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>（未登録）</p>
          ) : (
            <div className="flex flex-col gap-3">
              {editing[key].map((a, i) => {
                const direction: 'pickup' | 'dropoff' = key === 'custom_pickup_areas' ? 'pickup' : 'dropoff';
                return (
                  <div
                    key={a.id}
                    className="flex flex-col gap-2 rounded p-2"
                    style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        type="text"
                        value={a.emoji}
                        onChange={(e) => updateArea(key, i, 'emoji', e.target.value)}
                        style={emojiStyle}
                        maxLength={2}
                        aria-label="絵文字"
                      />
                      <input
                        type="text"
                        value={a.name}
                        onChange={(e) => updateArea(key, i, 'name', e.target.value)}
                        style={nameStyle}
                        placeholder="エリア名（例: おばあちゃん家）"
                        aria-label="エリア名"
                      />
                      <input
                        type="time"
                        value={a.time ?? ''}
                        onChange={(e) => updateArea(key, i, 'time', e.target.value)}
                        style={timeStyle}
                        step={600}
                        aria-label="基準時刻"
                      />
                      <input
                        type="text"
                        value={a.address ?? ''}
                        onChange={(e) => updateArea(key, i, 'address', e.target.value)}
                        style={addrStyle}
                        placeholder="住所（任意）"
                        aria-label="住所"
                      />
                      <button
                        type="button"
                        onClick={() => removeArea(key, i)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ color: 'var(--red)', border: '1px solid var(--rule)', background: 'var(--white)' }}
                        aria-label="削除"
                      >
                        🗑
                      </button>
                    </div>
                    <EligibleStaffPicker
                      areaId={a.id}
                      direction={direction}
                      editing={editing}
                      setEditing={setEditing}
                      staffList={staffList}
                      accent={accent}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * 児童専用エリア 1 件ごとの「担当可能職員」トグルピッカー。
 */
function EligibleStaffPicker({
  areaId,
  direction,
  editing,
  setEditing,
  staffList,
  accent,
}: {
  areaId: string;
  direction: 'pickup' | 'dropoff';
  editing: EditableChild;
  setEditing: (c: EditableChild) => void;
  staffList: StaffLite[];
  accent: string;
}) {
  const k = eligKey(areaId, direction);
  const selected = editing.eligibility.get(k) ?? new Set<string>();

  const ordered = [...staffList].sort((a, b) => {
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return staffDisplayName(a).localeCompare(staffDisplayName(b), 'ja');
  });

  const setSelected = (next: Set<string>) => {
    const nextElig = new Map(editing.eligibility);
    if (next.size === 0) nextElig.delete(k);
    else nextElig.set(k, next);
    setEditing({ ...editing, eligibility: nextElig });
  };

  const toggle = (staffId: string) => {
    const next = new Set(selected);
    if (next.has(staffId)) next.delete(staffId);
    else next.add(staffId);
    setSelected(next);
  };

  const selectAll = () => setSelected(new Set(staffList.map((s) => s.id)));
  const clearAll = () => setSelected(new Set());

  return (
    <div
      className="flex flex-col gap-1.5 rounded p-2"
      style={{ background: 'var(--bg)', border: '1px dashed var(--rule)' }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span
          className="text-[11px] font-bold tracking-wide"
          style={{ color: selected.size === 0 ? 'var(--red)' : 'var(--ink-2)' }}
        >
          担当可能職員: {selected.size === 0 ? '未設定' : `${selected.size}名`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={selectAll}
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ color: 'var(--ink-2)', border: '1px solid var(--rule)', background: 'var(--white)' }}
          >
            全員
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ color: 'var(--ink-2)', border: '1px solid var(--rule)', background: 'var(--white)' }}
          >
            解除
          </button>
        </div>
      </div>

      {staffList.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
          職員が登録されていません
        </p>
      ) : (
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}
        >
          {ordered.map((s) => {
            const on = selected.has(s.id);
            const label = staffDisplayName(s);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={{
                  background: on ? accent : 'var(--white)',
                  color: on ? 'var(--white)' : 'var(--ink)',
                  border: `1px solid ${on ? accent : 'var(--rule)'}`,
                  fontWeight: on ? 600 : 500,
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={label}
                aria-pressed={on}
              >
                {on ? '✓ ' : ''}
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
