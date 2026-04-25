'use client';

/**
 * 職員管理（shift-puzzle settings/staff/page.tsx 1181行を忠実移植）
 * - deaf-ic では「追加・招待・退職処理」は社員管理側で行うため、ここは編集専用
 * - エリア割当 / 基本勤務時間 / 雇用形態 / 資格 / 運転手・付き添い / 並び替え
 * - admin: facility 切替可 / manager: 自 facility 固定
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/shift-compat/Button';
import Badge from '@/components/shift-compat/Badge';
import Modal from '@/components/shift-compat/Modal';
import { staffDisplayName } from '@/lib/shift-utils';
import { useShiftFacilityId } from '@/lib/shift-facility';
import type { AreaLabel, QualificationType, Facility, EmploymentType } from '@/lib/types';

type EmployeeRole = 'admin' | 'manager' | 'employee';

const ROLE_LABELS: Record<EmployeeRole, string> = { admin: '管理者', manager: 'マネージャー', employee: '社員' };
const EMPLOYMENT_LABELS: Record<EmploymentType, string> = { full_time: '常勤', part_time: 'パート' };

const DEFAULT_START_TIME = '09:30';
const DEFAULT_END_TIME = '18:30';
const TIME_STEP_SECONDS = 600;

interface StaffRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
  last_name: string;
  first_name: string;
  email: string | null;
  role: EmployeeRole;
  status: 'active' | 'retired';
  employment_type: EmploymentType | null;
  default_start_time: string | null;
  default_end_time: string | null;
  pickup_transport_areas: string[];
  dropoff_transport_areas: string[];
  qualifications: string[];
  is_qualified: boolean;
  is_driver: boolean;
  is_attendant: boolean;
  shift_display_order: number | null;
}

type EditableStaff = {
  id: string;
  facility_id: string | null;
  name: string;          // 表示用（last_name + first_name）
  email: string | null;  // 読取専用
  role: EmployeeRole;    // 読取専用
  employment_type: EmploymentType;
  default_start_time: string;
  default_end_time: string;
  pickup_transport_areas: string[];
  dropoff_transport_areas: string[];
  qualifications: string[];
  is_qualified: boolean;
  is_driver: boolean;
  is_attendant: boolean;
};

interface Props {
  scope: 'admin' | 'manager';
}

/**
 * 一覧の対応エリア表示用ホバーポップオーバー
 */
function TransportAreasPopover({
  pickup,
  dropoff,
}: {
  pickup: AreaLabel[];
  dropoff: AreaLabel[];
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const estimatedHeight = 40
    + (pickup.length > 0 ? 28 + pickup.length * 34 : 0)
    + (dropoff.length > 0 ? 28 + dropoff.length * 34 : 0);

  const updateCoords = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const POPOVER_WIDTH = 220;
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - POPOVER_WIDTH - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
      setCoords({ bottom: window.innerHeight - rect.top + 4, left });
    } else {
      setCoords({ top: rect.bottom + 4, left });
    }
  };

  const handleOpen = () => { updateCoords(); setOpen(true); };
  const handleClose = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const totalCount = pickup.length + dropoff.length;
  if (totalCount === 0) {
    return <span style={{ color: 'var(--ink-3)' }}>-</span>;
  }

  const renderSection = (direction: 'pickup' | 'dropoff', items: AreaLabel[]) => {
    if (items.length === 0) return null;
    const accentVar = direction === 'pickup' ? 'var(--accent)' : 'var(--green)';
    const palVar = direction === 'pickup' ? 'var(--accent-pale)' : 'var(--green-pale)';
    const label = direction === 'pickup' ? '迎対応' : '送り対応';
    return (
      <div className="flex flex-col gap-1.5 rounded-md p-2" style={{ border: '1px solid var(--rule)', background: palVar }}>
        <span className="text-[0.65rem] font-bold" style={{ color: accentVar }}>{label}</span>
        <div className="flex flex-col gap-1">
          {items.map((a) => (
            <span
              key={`${direction}-${a.id}`}
              className="rounded-md"
              style={{
                padding: '5px 10px',
                fontSize: '0.75rem',
                fontWeight: 500,
                background: 'var(--white)',
                color: accentVar,
                border: `1px solid ${accentVar}`,
              }}
            >
              {a.emoji} {a.name}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="relative inline-block" onMouseEnter={handleOpen} onMouseLeave={handleClose}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? handleClose() : handleOpen())}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors"
        style={{
          background: 'var(--white)',
          border: '1px solid var(--rule)',
          fontSize: '0.7rem',
          color: 'var(--ink-2)',
          fontWeight: 500,
        }}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {pickup.length > 0 && (
          <span className="inline-flex items-center gap-0.5" style={{ color: 'var(--accent)' }}>
            <span className="font-bold">迎</span>
            <span>{pickup.length}</span>
          </span>
        )}
        {pickup.length > 0 && dropoff.length > 0 && (<span style={{ color: 'var(--rule-strong)' }}>/</span>)}
        {dropoff.length > 0 && (
          <span className="inline-flex items-center gap-0.5" style={{ color: 'var(--green)' }}>
            <span className="font-bold">送</span>
            <span>{dropoff.length}</span>
          </span>
        )}
        <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: '0.65rem' }}>ⓘ</span>
      </button>
      {open && coords && (
        <div
          role="tooltip"
          className="flex flex-col gap-2"
          style={{
            position: 'fixed',
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            zIndex: 1000,
            background: 'var(--white)',
            border: '1px solid var(--rule-strong)',
            borderRadius: '8px',
            padding: '10px',
            boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
            width: '220px',
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          {renderSection('pickup', pickup)}
          {renderSection('dropoff', dropoff)}
        </div>
      )}
    </div>
  );
}

export default function StaffSettingsFull({ scope }: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [me, setMe] = useState<{ id: string; tenant_id: string; facility_id: string | null } | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [shiftFacilityId, setShiftFacilityId] = useShiftFacilityId();
  // manager は自 facility 固定、admin は上部ヘッダーの選択に従う
  const selectedFacilityId =
    scope === 'manager' ? (me?.facility_id ?? '') : (shiftFacilityId ?? '');
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [pickupAreas, setPickupAreas] = useState<AreaLabel[]>([]);
  const [dropoffAreas, setDropoffAreas] = useState<AreaLabel[]>([]);
  const [qualificationTypes, setQualificationTypes] = useState<QualificationType[]>([]);
  const [editing, setEditing] = useState<EditableStaff | null>(null);
  const [draggingStaffIdx, setDraggingStaffIdx] = useState<number | null>(null);
  const [dragOverStaffIdx, setDragOverStaffIdx] = useState<number | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const loadBasics = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: meRow } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (!meRow) return;
    setMe(meRow);

    const { data: facData } = await supabase
      .from('facilities')
      .select('id, tenant_id, name, address, created_at')
      .eq('tenant_id', meRow.tenant_id)
      .order('created_at');
    const all = (facData as Facility[]) || [];
    const scoped = scope === 'manager' && meRow.facility_id
      ? all.filter((f) => f.id === meRow.facility_id)
      : all;
    setFacilities(scoped);

    // admin かつ shiftFacilityId 未設定なら先頭で自動選択
    if (scope === 'admin' && !shiftFacilityId && scoped[0]) {
      setShiftFacilityId(scoped[0].id);
    }
  }, [supabase, scope, shiftFacilityId, setShiftFacilityId]);

  const loadFacilityData = useCallback(async () => {
    if (!me || !selectedFacilityId) return;
    setError('');
    try {
      // 職員一覧（自facility）
      const baseSel = supabase
        .from('employees')
        .select('id, tenant_id, facility_id, last_name, first_name, email, role, status, employment_type, default_start_time, default_end_time, pickup_transport_areas, dropoff_transport_areas, qualifications, is_qualified, is_driver, is_attendant, shift_display_order')
        .eq('tenant_id', me.tenant_id)
        .eq('facility_id', selectedFacilityId);
      const filteredSel = showRetired ? baseSel : baseSel.eq('status', 'active');
      const { data: empRows } = await filteredSel
        .order('shift_display_order', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true });
      setStaffList(((empRows ?? []) as StaffRow[]));

      // facility_shift_settings
      const { data: fs } = await supabase
        .from('facility_shift_settings')
        .select('pickup_area_labels, dropoff_area_labels, qualification_types')
        .eq('facility_id', selectedFacilityId)
        .maybeSingle();
      if (fs) {
        setPickupAreas(Array.isArray(fs.pickup_area_labels) ? fs.pickup_area_labels : []);
        setDropoffAreas(Array.isArray(fs.dropoff_area_labels) ? fs.dropoff_area_labels : []);
        setQualificationTypes(Array.isArray(fs.qualification_types) ? fs.qualification_types : []);
      } else {
        setPickupAreas([]);
        setDropoffAreas([]);
        setQualificationTypes([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [supabase, me, selectedFacilityId, showRetired]);

  useEffect(() => { loadBasics().then(() => setLoading(false)); }, [loadBasics]);
  useEffect(() => { loadFacilityData(); }, [loadFacilityData]);

  const countable = qualificationTypes.filter((q) => q.countable).map((q) => q.name);

  const pickupById = new Map(pickupAreas.map((a) => [a.id, a]));
  const dropoffById = new Map(dropoffAreas.map((a) => [a.id, a]));
  const resolveAreas = (ids: string[] | null | undefined, src: 'pickup' | 'dropoff'): AreaLabel[] => {
    const lookup = src === 'pickup' ? pickupById : dropoffById;
    if (!Array.isArray(ids)) return [];
    return ids.map((id) => lookup.get(id)).filter((a): a is AreaLabel => !!a);
  };

  const handleEdit = (s: StaffRow) => {
    setEditing({
      id: s.id,
      facility_id: s.facility_id,
      name: staffDisplayName(s),
      email: s.email,
      role: s.role,
      employment_type: s.employment_type ?? 'part_time',
      default_start_time: s.default_start_time ?? DEFAULT_START_TIME,
      default_end_time: s.default_end_time ?? DEFAULT_END_TIME,
      pickup_transport_areas: s.pickup_transport_areas ?? [],
      dropoff_transport_areas: s.dropoff_transport_areas ?? [],
      qualifications: s.qualifications ?? [],
      is_qualified: s.is_qualified ?? false,
      is_driver: s.is_driver ?? false,
      is_attendant: s.is_attendant ?? false,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    setInfo('');
    try {
      const { error: upErr } = await supabase
        .from('employees')
        .update({
          employment_type: editing.employment_type,
          default_start_time: editing.default_start_time || null,
          default_end_time: editing.default_end_time || null,
          pickup_transport_areas: editing.pickup_transport_areas,
          dropoff_transport_areas: editing.dropoff_transport_areas,
          qualifications: editing.qualifications,
          is_qualified: editing.is_qualified,
          is_driver: editing.is_driver,
          is_attendant: editing.is_attendant,
        })
        .eq('id', editing.id);
      if (upErr) throw new Error(upErr.message);
      setInfo('更新しました');
      setTimeout(() => setInfo(''), 2000);
      setEditing(null);
      await loadFacilityData();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleAreaToggle = (direction: 'pickup' | 'dropoff', area: string) => {
    if (!editing) return;
    const key = direction === 'pickup' ? 'pickup_transport_areas' : 'dropoff_transport_areas';
    const current = editing[key];
    const has = current.includes(area);
    setEditing({
      ...editing,
      [key]: has ? current.filter((a) => a !== area) : [...current, area],
    });
  };

  const handleReorderStaff = async (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= staffList.length || to >= staffList.length) return;
    const next = [...staffList];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setStaffList(next);
    try {
      for (let i = 0; i < next.length; i++) {
        const { error: upErr } = await supabase
          .from('employees')
          .update({ shift_display_order: i })
          .eq('id', next[i].id);
        if (upErr) throw new Error(upErr.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '並び替えに失敗しました');
      await loadFacilityData();
    }
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', color: 'var(--ink)',
    border: '1px solid var(--rule)', borderRadius: '6px',
    padding: '8px 12px', fontSize: '0.9rem',
  };

  if (loading) {
    return <div className="p-6" style={{ color: 'var(--ink-3)' }}>読み込み中...</div>;
  }

  if (facilities.length === 0) {
    return (
      <div className="p-6 rounded-md" style={{ background: 'var(--red-pale)', color: 'var(--red)' }}>
        事業所が登録されていません。
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="info">{staffList.filter((s) => s.status === 'active').length}名</Badge>
          <label className="flex items-center gap-1 text-sm cursor-pointer" style={{ color: 'var(--ink-2)' }}>
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
            />
            退職者も表示
          </label>
        </div>
        <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
          職員の追加・退職処理は <a href="/admin/employees" className="underline" style={{ color: 'var(--accent)' }}>社員管理</a> から行います
        </div>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2 rounded" style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      {info && (
        <div className="mb-3 px-4 py-2 rounded" style={{ background: 'var(--green-pale)', color: 'var(--green)', fontSize: '0.85rem' }}>
          {info}
        </div>
      )}

      {/* デスクトップ・タブレット */}
      <div className="hidden md:block overflow-x-auto" style={{ borderRadius: '8px', border: '1px solid var(--rule)' }}>
        <table className="w-full border-collapse" style={{ fontSize: '0.85rem', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th
                className="px-2 py-2 text-center font-semibold"
                style={{ background: 'var(--ink)', color: '#fff', width: '36px' }}
                title="ドラッグで並び替え"
              >
                ↕
              </th>
              {[
                { label: '氏名', minWidth: '220px' },
                { label: '資格', minWidth: '180px' },
                { label: 'ロール', minWidth: '100px' },
                { label: '雇用', minWidth: '70px' },
                { label: '勤務時間', minWidth: '130px' },
                { label: '対応エリア', minWidth: '200px' },
              ].map((col) => (
                <th
                  key={col.label}
                  className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                  style={{ background: 'var(--ink)', color: '#fff', minWidth: col.minWidth }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staffList.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center" style={{ color: 'var(--ink-3)' }}>
                  職員が登録されていません
                </td>
              </tr>
            )}
            {staffList.map((s, idx) => {
              const isDragging = draggingStaffIdx === idx;
              const isDropTarget = dragOverStaffIdx === idx && draggingStaffIdx !== null && draggingStaffIdx !== idx;
              const pickupIds = s.pickup_transport_areas ?? [];
              const dropoffIds = s.dropoff_transport_areas ?? [];
              return (
                <tr
                  key={s.id}
                  onDragOver={(e) => {
                    if (draggingStaffIdx === null || draggingStaffIdx === idx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverStaffIdx(idx);
                  }}
                  onDragLeave={() => {
                    if (dragOverStaffIdx === idx) setDragOverStaffIdx(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingStaffIdx !== null && draggingStaffIdx !== idx) {
                      handleReorderStaff(draggingStaffIdx, idx);
                    }
                    setDraggingStaffIdx(null);
                    setDragOverStaffIdx(null);
                  }}
                  className="hover:bg-[var(--accent-pale)] transition-colors cursor-pointer"
                  style={{
                    opacity: s.status === 'retired' ? 0.55 : isDragging ? 0.4 : 1,
                    background: isDropTarget ? 'var(--accent-pale)' : s.status === 'retired' ? 'var(--bg)' : undefined,
                  }}
                  onClick={() => handleEdit(s)}
                >
                  <td
                    className="px-1 py-2 text-center"
                    style={{ borderBottom: '1px solid var(--rule)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      draggable
                      onDragStart={(e) => {
                        setDraggingStaffIdx(idx);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(idx));
                      }}
                      onDragEnd={() => {
                        setDraggingStaffIdx(null);
                        setDragOverStaffIdx(null);
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
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink)' }}>
                    <div className="flex flex-col gap-1">
                      <div className="font-medium whitespace-nowrap">{staffDisplayName(s)}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.status === 'retired' && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--red-pale)', color: 'var(--red)' }}
                          >
                            退職
                          </span>
                        )}
                        {s.is_driver && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-pale)', color: 'var(--accent)' }}>
                            🚗 運転手
                          </span>
                        )}
                        {s.is_attendant && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--green-pale)', color: 'var(--green)' }}>
                            🧑‍🤝‍🧑 付き添い
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)', fontSize: '0.8rem' }}>
                    {(s.qualifications ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(s.qualifications ?? []).map((q) => (
                          <span
                            key={q}
                            className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap"
                            style={{
                              background: countable.includes(q) ? 'var(--green-pale)' : 'var(--bg)',
                              color: countable.includes(q) ? 'var(--green)' : 'var(--ink-3)',
                              fontSize: '0.7rem',
                            }}
                          >
                            {q}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ borderBottom: '1px solid var(--rule)' }}>
                    <Badge variant={s.role === 'admin' ? 'error' : s.role === 'manager' ? 'info' : 'neutral'}>
                      {ROLE_LABELS[s.role]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink-2)' }}>
                    {s.employment_type ? EMPLOYMENT_LABELS[s.employment_type] : '-'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink-2)' }}>
                    {s.default_start_time ?? '-'}〜{s.default_end_time ?? '-'}
                  </td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--rule)' }}>
                    <TransportAreasPopover pickup={resolveAreas(pickupIds, 'pickup')} dropoff={resolveAreas(dropoffIds, 'dropoff')} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* モバイル */}
      <div className="md:hidden flex flex-col gap-3">
        {staffList.length === 0 && (
          <div className="px-3 py-6 text-center rounded-lg" style={{ background: 'var(--bg)', color: 'var(--ink-3)' }}>
            職員が登録されていません
          </div>
        )}
        {staffList.map((s) => (
          <div
            key={s.id}
            onClick={() => handleEdit(s)}
            className="p-3 rounded-lg cursor-pointer transition-colors hover:bg-[var(--accent-pale)]"
            style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base" style={{ color: 'var(--ink)' }}>
                  {staffDisplayName(s)}
                </div>
                <div className="text-xs mt-0.5 break-all" style={{ color: 'var(--ink-3)' }}>
                  {s.email ?? '（メール未設定）'}
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end shrink-0">
                <Badge variant={s.role === 'admin' ? 'error' : s.role === 'manager' ? 'info' : 'neutral'}>
                  {ROLE_LABELS[s.role]}
                </Badge>
                <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                  {s.employment_type ? EMPLOYMENT_LABELS[s.employment_type] : '-'}
                </span>
              </div>
            </div>
            <div className="text-xs mb-1" style={{ color: 'var(--ink-2)' }}>
              <span className="font-medium">勤務: </span>
              {s.default_start_time ?? '-'}〜{s.default_end_time ?? '-'}
            </div>
            {(() => {
              const pickupIds = s.pickup_transport_areas ?? [];
              const dropoffIds = s.dropoff_transport_areas ?? [];
              if (pickupIds.length === 0 && dropoffIds.length === 0) return null;
              return (
                <div className="mb-1">
                  <TransportAreasPopover pickup={resolveAreas(pickupIds, 'pickup')} dropoff={resolveAreas(dropoffIds, 'dropoff')} />
                </div>
              );
            })()}
            {(s.qualifications ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(s.qualifications ?? []).map((q) => (
                  <span
                    key={q}
                    className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap"
                    style={{
                      background: countable.includes(q) ? 'var(--green-pale)' : 'var(--bg)',
                      color: countable.includes(q) ? 'var(--green)' : 'var(--ink-3)',
                      fontSize: '0.7rem',
                    }}
                  >
                    {q}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.name} を編集` : ''}
        size="lg"
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>氏名</label>
                <input
                  type="text"
                  value={editing.name}
                  className="outline-none"
                  style={{ ...inputStyle, background: 'var(--bg)', color: 'var(--ink-3)' }}
                  disabled
                />
                <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>氏名の変更は社員管理から</p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>メール</label>
                <input
                  type="email"
                  value={editing.email ?? ''}
                  className="outline-none"
                  style={{ ...inputStyle, background: 'var(--bg)', color: 'var(--ink-3)' }}
                  disabled
                />
              </div>
            </div>

            {/* 送迎役割 */}
            <div
              className="flex flex-col gap-2 p-3 rounded"
              style={{ background: 'var(--accent-pale)', border: '1.5px solid var(--accent)' }}
            >
              <label className="text-sm font-bold" style={{ color: 'var(--accent)' }}>🚐 送迎役割</label>
              <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                左スロット（主担当）= 運転手のみ / 右スロット（副担当）= 運転手 or 付き添い。両方オフなら送迎担当候補に出ません。
              </p>
              <div className="flex flex-wrap gap-2">
                {([
                  { key: 'is_driver' as const, label: '🚗 運転手', color: 'var(--accent)' },
                  { key: 'is_attendant' as const, label: '🧑‍🤝‍🧑 付き添い', color: 'var(--green)' },
                ]).map(({ key, label, color }) => {
                  const on = editing[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEditing({ ...editing, [key]: !on })}
                      className="text-sm font-semibold px-4 py-2 rounded transition-colors"
                      style={{
                        background: on ? color : 'var(--white)',
                        color: on ? '#fff' : 'var(--ink-2)',
                        border: `1.5px solid ${on ? color : 'var(--rule)'}`,
                      }}
                    >
                      {on ? '✓ ' : ''}{label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>ロール</label>
                <input
                  type="text"
                  value={ROLE_LABELS[editing.role]}
                  className="outline-none"
                  style={{ ...inputStyle, background: 'var(--bg)', color: 'var(--ink-3)' }}
                  disabled
                />
                <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>ロールの変更は社員管理から</p>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>雇用形態</label>
                <select value={editing.employment_type} onChange={(e) => setEditing({ ...editing, employment_type: e.target.value as EmploymentType })} className="outline-none" style={inputStyle}>
                  <option value="full_time">常勤</option>
                  <option value="part_time">パート</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>出勤時間</label>
                <input
                  type="time"
                  step={TIME_STEP_SECONDS}
                  value={editing.default_start_time}
                  onChange={(e) => setEditing({ ...editing, default_start_time: e.target.value })}
                  className="outline-none"
                  style={inputStyle}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>退勤時間</label>
                <input
                  type="time"
                  step={TIME_STEP_SECONDS}
                  value={editing.default_end_time}
                  onChange={(e) => setEditing({ ...editing, default_end_time: e.target.value })}
                  className="outline-none"
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              className="flex items-start gap-2 rounded-md p-3"
              style={{
                background: 'var(--accent-pale)',
                borderLeft: '4px solid var(--accent)',
                fontSize: '0.8rem',
                color: 'var(--ink)',
              }}
            >
              <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1 }}>ℹ️</span>
              <span>
                <strong style={{ fontWeight: 700 }}>児童専用エリア</strong>
                （🐻 祖母宅 など、特定の児童にだけ設定されるエリア）の担当設定は、
                <strong style={{ fontWeight: 700 }}>児童管理 → 専用エリア</strong>
                から行ってください。ここでは事業所共通エリアのみ設定します。
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['pickup', 'dropoff'] as const).map((direction) => {
                const key = direction === 'pickup' ? 'pickup_transport_areas' : 'dropoff_transport_areas';
                const label = direction === 'pickup' ? '迎対応' : '送り対応';
                const accentVar = direction === 'pickup' ? 'var(--accent)' : 'var(--green)';
                const palVar = direction === 'pickup' ? 'var(--accent-pale)' : 'var(--green-pale)';
                const areas = direction === 'pickup' ? pickupAreas : dropoffAreas;
                const selected = editing[key];
                return (
                  <div
                    key={direction}
                    className="flex flex-col gap-1.5 rounded-md p-2"
                    style={{ border: '1px solid var(--rule)', background: palVar }}
                  >
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold" style={{ color: accentVar }}>{label}エリア</label>
                      {areas.length > 0 && (
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => setEditing({ ...editing, [key]: areas.map((a) => a.id) })}
                            style={{ color: accentVar, textDecoration: 'underline' }}
                          >全選択</button>
                          <span style={{ color: 'var(--ink-3)' }}>/</span>
                          <button
                            type="button"
                            onClick={() => setEditing({ ...editing, [key]: [] })}
                            style={{ color: 'var(--ink-3)', textDecoration: 'underline' }}
                          >全解除</button>
                        </div>
                      )}
                    </div>
                    {areas.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                        （事業所設定で{label}エリアを追加してください）
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {areas.map((area) => {
                          const on = selected.includes(area.id);
                          return (
                            <button
                              key={area.id}
                              type="button"
                              onClick={() => handleAreaToggle(direction, area.id)}
                              className="rounded-md transition-all text-left"
                              style={{
                                padding: '5px 10px',
                                fontSize: '0.78rem',
                                fontWeight: 500,
                                background: on ? accentVar : 'var(--white)',
                                color: on ? '#fff' : 'var(--ink-2)',
                                border: `1px solid ${on ? accentVar : 'var(--rule)'}`,
                              }}
                            >
                              {on ? '✓ ' : ''}{area.emoji} {area.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>保有資格</label>
              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                緑=カウント対象 / グレー=配置基準外
              </p>
              <div className="flex flex-wrap gap-2">
                {qualificationTypes.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                    （事業所設定で資格種類を追加してください）
                  </p>
                )}
                {qualificationTypes.map((q) => {
                  const has = editing.qualifications.includes(q.name);
                  return (
                    <button
                      key={q.name}
                      type="button"
                      onClick={() => {
                        const updated = has
                          ? editing.qualifications.filter((n) => n !== q.name)
                          : [...editing.qualifications, q.name];
                        const isQualified = updated.some((n) => countable.includes(n));
                        setEditing({ ...editing, qualifications: updated, is_qualified: isQualified });
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                      style={{
                        background: has ? (q.countable ? 'var(--green)' : 'var(--ink-3)') : 'var(--bg)',
                        color: has ? '#fff' : (q.countable ? 'var(--green)' : 'var(--ink-3)'),
                        border: `1px solid ${has ? (q.countable ? 'var(--green)' : 'var(--ink-3)') : 'var(--rule)'}`,
                      }}
                    >
                      {q.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>キャンセル</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
