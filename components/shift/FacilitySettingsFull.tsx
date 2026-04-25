'use client';

/**
 * 事業所設定（shift-puzzle settings/tenant/page.tsx 忠実移植）
 * - エリア（迎/送）/ 資格 / 有資格者最低人数 / 退勤時刻下限 / 迎クールダウン / 休み希望締切
 * - 元はテナント単位だったが、deaf-ic では facility_shift_settings に格納（facility 単位）
 * - admin: facility 切替可 / manager: 自 facility 固定
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/shift-compat/Button';
import Badge from '@/components/shift-compat/Badge';
import { useShiftFacilityId } from '@/lib/shift-facility';
import type { AreaLabel, QualificationType, Facility } from '@/lib/types';

// shift-puzzle 由来のデフォルト値
const DEFAULT_TRANSPORT_MIN_END_TIME = '16:31';
const DEFAULT_PICKUP_COOLDOWN_MINUTES = 45;
const AREA_TIME_STEP_SECONDS = 600; // 10分ステップ

// shift-puzzle のデフォルト資格（NPO 用にカスタマイズ可能）
const DEFAULT_QUALIFICATIONS: QualificationType[] = [
  { name: '保育士', countable: true },
  { name: '幼稚園教諭', countable: true },
  { name: '児童指導員', countable: true },
  { name: '教師', countable: true },
  { name: '児童発達支援管理責任者', countable: false },
  { name: '専門職員', countable: false },
  { name: '加配加算', countable: false },
];

const ensureAreaIds = (areas: AreaLabel[] | undefined | null): AreaLabel[] => {
  if (!Array.isArray(areas)) return [];
  return areas.map((a) => (a.id ? a : { ...a, id: genId() }));
};

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Props {
  scope: 'admin' | 'manager';
}

export default function FacilitySettingsFull({ scope }: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [me, setMe] = useState<{ id: string; tenant_id: string; facility_id: string | null } | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [shiftFacilityId, setShiftFacilityId] = useShiftFacilityId();
  // manager は自 facility 固定、admin は上部ヘッダーの選択に従う
  const selectedFacilityId =
    scope === 'manager' ? (me?.facility_id ?? '') : (shiftFacilityId ?? '');

  const [pickupAreas, setPickupAreas] = useState<AreaLabel[]>([]);
  const [dropoffAreas, setDropoffAreas] = useState<AreaLabel[]>([]);
  const [qualifications, setQualifications] = useState<QualificationType[]>(DEFAULT_QUALIFICATIONS);
  const [minQualified, setMinQualified] = useState(2);
  const [requestDeadline, setRequestDeadline] = useState(20);
  const [transportMinEndTime, setTransportMinEndTime] = useState<string>(DEFAULT_TRANSPORT_MIN_END_TIME);
  const [pickupCooldownMinutes, setPickupCooldownMinutes] = useState<number>(DEFAULT_PICKUP_COOLDOWN_MINUTES);
  /* migration 116: コアタイム（提供時間） */
  const [coreStartTime, setCoreStartTime] = useState<string>('10:30');
  const [coreEndTime, setCoreEndTime] = useState<string>('16:30');

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
    const allFacs = (facData as Facility[]) || [];
    const scopedFacs = scope === 'manager' && meRow.facility_id
      ? allFacs.filter((f) => f.id === meRow.facility_id)
      : allFacs;
    setFacilities(scopedFacs);

    /* 初期化は layout に集約。useShiftFacilityId フックは初回 null を返すため、
       ここで先頭施設を強制セットすると layout が設定した値を上書きしてしまう。fallback 削除。 */
  }, [supabase, scope, shiftFacilityId, setShiftFacilityId]);

  const loadSettings = useCallback(async () => {
    if (!me || !selectedFacilityId) return;
    setError('');
    try {
      const { data } = await supabase
        .from('facility_shift_settings')
        .select('*')
        .eq('facility_id', selectedFacilityId)
        .maybeSingle();

      if (data) {
        setPickupAreas(ensureAreaIds(data.pickup_area_labels));
        setDropoffAreas(ensureAreaIds(data.dropoff_area_labels));
        setQualifications(
          Array.isArray(data.qualification_types) && data.qualification_types.length > 0
            ? data.qualification_types
            : DEFAULT_QUALIFICATIONS
        );
        setMinQualified(data.min_qualified_staff ?? 2);
        setRequestDeadline(data.request_deadline_day ?? 20);
        setTransportMinEndTime((data.transport_min_end_time ?? DEFAULT_TRANSPORT_MIN_END_TIME).slice(0, 5));
        setPickupCooldownMinutes(data.transport_pickup_cooldown_minutes ?? DEFAULT_PICKUP_COOLDOWN_MINUTES);
        setCoreStartTime((data.core_start_time ?? '10:30').slice(0, 5));
        setCoreEndTime((data.core_end_time ?? '16:30').slice(0, 5));
      } else {
        // 設定未存在: shift-puzzle のデフォルトで初期化
        setPickupAreas([]);
        setDropoffAreas([]);
        setQualifications(DEFAULT_QUALIFICATIONS);
        setMinQualified(2);
        setRequestDeadline(20);
        setTransportMinEndTime(DEFAULT_TRANSPORT_MIN_END_TIME);
        setPickupCooldownMinutes(DEFAULT_PICKUP_COOLDOWN_MINUTES);
        setCoreStartTime('10:30');
        setCoreEndTime('16:30');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [supabase, me, selectedFacilityId]);

  useEffect(() => {
    loadBasics().then(() => setLoading(false));
  }, [loadBasics]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const reorderItem = <T,>(arr: T[], from: number, to: number): T[] => {
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const handleAddPickupArea = () =>
    setPickupAreas([...pickupAreas, { id: genId(), emoji: '📍', name: '', time: '', address: '' }]);
  const handleRemovePickupArea = (i: number) =>
    setPickupAreas(pickupAreas.filter((_, idx) => idx !== i));
  const handlePickupAreaChange = (i: number, field: keyof AreaLabel, value: string) =>
    setPickupAreas(pickupAreas.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  const handleReorderPickupArea = (from: number, to: number) =>
    setPickupAreas(reorderItem(pickupAreas, from, to));

  const handleAddDropoffArea = () =>
    setDropoffAreas([...dropoffAreas, { id: genId(), emoji: '🏠', name: '', time: '', address: '' }]);
  const handleRemoveDropoffArea = (i: number) =>
    setDropoffAreas(dropoffAreas.filter((_, idx) => idx !== i));
  const handleDropoffAreaChange = (i: number, field: keyof AreaLabel, value: string) =>
    setDropoffAreas(dropoffAreas.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  const handleReorderDropoffArea = (from: number, to: number) =>
    setDropoffAreas(reorderItem(dropoffAreas, from, to));

  const handleSave = async () => {
    if (!me || !selectedFacilityId) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        facility_id: selectedFacilityId,
        tenant_id: me.tenant_id,
        min_qualified_staff: minQualified,
        pickup_area_labels: pickupAreas,
        dropoff_area_labels: dropoffAreas,
        qualification_types: qualifications,
        request_deadline_day: requestDeadline,
        transport_min_end_time: `${transportMinEndTime}:00`,
        transport_pickup_cooldown_minutes: pickupCooldownMinutes,
        core_start_time: `${coreStartTime}:00`,
        core_end_time: `${coreEndTime}:00`,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await supabase
        .from('facility_shift_settings')
        .upsert(payload, { onConflict: 'facility_id' });
      if (upErr) throw new Error(upErr.message);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)',
    color: 'var(--ink)',
    border: '1px solid var(--rule)',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '0.9rem',
  };

  if (loading) {
    return <div className="p-6" style={{ color: 'var(--ink-3)' }}>読み込み中...</div>;
  }

  if (facilities.length === 0) {
    return (
      <div className="p-6 rounded-md" style={{ background: 'var(--red-pale)', color: 'var(--red)' }}>
        事業所が登録されていません。先に管理者で事業所を追加してください。
      </div>
    );
  }

  const selectedFacility = facilities.find((f) => f.id === selectedFacilityId);

  return (
    <>
      {error && (
        <div className="mb-4 px-4 py-3 rounded" style={{ background: 'var(--red-pale)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 max-w-2xl">
          <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>事業所名</label>
          <div className="px-3 py-2 rounded" style={{ background: 'var(--bg)', color: 'var(--ink-2)', border: '1px solid var(--rule)' }}>
            {selectedFacility?.name ?? ''}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>事業所名の編集はシステム管理者にお問い合わせください</p>
        </div>

        {/* 送迎エリア: 迎 / 送 を2カラム */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>送迎エリア</label>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
              マーク・エリア名・時間はセットで扱います。児童の送迎パターンでエリアを選ぶと時間が自動入力されます（編集可能）。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AreaListSection
              title="迎のエリア"
              titleColor="var(--accent)"
              areas={pickupAreas}
              onChange={handlePickupAreaChange}
              onRemove={handleRemovePickupArea}
              onAdd={handleAddPickupArea}
              onReorder={handleReorderPickupArea}
              inputStyle={inputStyle}
              emptyMessage="迎のエリアを追加してください"
            />
            <AreaListSection
              title="送のエリア"
              titleColor="var(--green)"
              areas={dropoffAreas}
              onChange={handleDropoffAreaChange}
              onRemove={handleRemoveDropoffArea}
              onAdd={handleAddDropoffArea}
              onReorder={handleReorderDropoffArea}
              inputStyle={inputStyle}
              emptyMessage="送のエリアを追加してください"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 max-w-2xl">
          <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>資格種類</label>
          <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
            「カウント対象」がONの資格を持つ職員が、シフト生成時の有資格者カウントに含まれます。
          </p>
          <div className="flex flex-col gap-1.5">
            {qualifications.map((q, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2"
                style={{
                  background: q.countable ? 'var(--green-pale)' : 'var(--bg)',
                  borderRadius: '6px',
                  border: `1px solid ${q.countable ? 'rgba(42,122,82,0.15)' : 'var(--rule)'}`,
                }}
              >
                <input
                  type="text"
                  value={q.name}
                  onChange={(e) => {
                    const updated = [...qualifications];
                    updated[i] = { ...q, name: e.target.value };
                    setQualifications(updated);
                  }}
                  className="flex-1 outline-none text-sm bg-transparent"
                  style={{ color: 'var(--ink)' }}
                />
                <label className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap cursor-pointer">
                  <input
                    type="checkbox"
                    checked={q.countable}
                    onChange={(e) => {
                      const updated = [...qualifications];
                      updated[i] = { ...q, countable: e.target.checked };
                      setQualifications(updated);
                    }}
                  />
                  <span style={{ color: q.countable ? 'var(--green)' : 'var(--ink-3)' }}>
                    カウント対象
                  </span>
                </label>
                <button
                  onClick={() => setQualifications(qualifications.filter((_, j) => j !== i))}
                  className="text-xs px-1 hover:opacity-70"
                  style={{ color: 'var(--red)' }}
                >
                  ✕
                </button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => setQualifications([...qualifications, { name: '', countable: true }])}
            >
              + 資格追加
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 max-w-2xl">
          <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>有資格者の最低出勤人数</label>
          <input
            type="number"
            min={1}
            max={10}
            value={minQualified}
            onChange={(e) => setMinQualified(parseInt(e.target.value) || 1)}
            className="w-24 outline-none"
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-2 max-w-2xl">
          <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>提供時間（コアタイム）</label>
          <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
            シフト表サイドバーの「有資格者基準」「提供時間内の有資格者」判定に使われる中核時間帯。
            この時間帯を最低 {minQualified} 名の有資格者で常時カバーすることが基準です。
          </p>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={coreStartTime}
              onChange={(e) => setCoreStartTime(e.target.value || '10:30')}
              className="w-32 outline-none"
              style={inputStyle}
              aria-label="コアタイム開始"
            />
            <span style={{ color: 'var(--ink-3)' }}>〜</span>
            <input
              type="time"
              value={coreEndTime}
              onChange={(e) => setCoreEndTime(e.target.value || '16:30')}
              className="w-32 outline-none"
              style={inputStyle}
              aria-label="コアタイム終了"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 max-w-2xl">
          <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>送迎候補に含める退勤時刻の下限</label>
          <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
            退勤時刻がこの値より早い職員は、送迎の担当候補に含めません。送り送迎の最早時刻（例 16:30）より少し後に設定するのが標準です。
          </p>
          <input
            type="time"
            value={transportMinEndTime}
            onChange={(e) => setTransportMinEndTime(e.target.value || DEFAULT_TRANSPORT_MIN_END_TIME)}
            className="w-32 outline-none"
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-2 max-w-2xl">
          <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
            迎え連続担当の禁止時間（分）
          </label>
          <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
            ある職員が迎を担当した後、この分数が経過するまで別の迎には自動割当されません。
            例: 45 を指定すると、13:20 に迎を行った職員は 14:05 まで次の迎の候補外。
            送り側には適用されません。手動編集は制約対象外です。
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={180}
              step={5}
              value={pickupCooldownMinutes}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setPickupCooldownMinutes(Number.isNaN(v) ? DEFAULT_PICKUP_COOLDOWN_MINUTES : Math.max(0, Math.min(180, v)));
              }}
              className="w-24 outline-none"
              style={inputStyle}
            />
            <span className="text-sm" style={{ color: 'var(--ink-2)' }}>分</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 max-w-2xl">
          <label className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>休み希望の締切日</label>
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--ink-2)' }}>前月</span>
            <input
              type="number"
              min={1}
              max={28}
              value={requestDeadline}
              onChange={(e) => setRequestDeadline(parseInt(e.target.value) || 20)}
              className="w-20 outline-none"
              style={inputStyle}
            />
            <span className="text-sm" style={{ color: 'var(--ink-2)' }}>日まで</span>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
          {saved && <Badge variant="success">保存しました</Badge>}
        </div>
      </div>
    </>
  );
}

/* ---------- エリアリスト（迎/送共通の子コンポーネント） ---------- */
type AreaListSectionProps = {
  title: string;
  titleColor: string;
  areas: AreaLabel[];
  onChange: (i: number, field: keyof AreaLabel, value: string) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  onReorder: (from: number, to: number) => void;
  inputStyle: React.CSSProperties;
  emptyMessage: string;
};

function GripIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill={color} aria-hidden>
      <circle cx="4" cy="4" r="1.3" />
      <circle cx="10" cy="4" r="1.3" />
      <circle cx="4" cy="9" r="1.3" />
      <circle cx="10" cy="9" r="1.3" />
      <circle cx="4" cy="14" r="1.3" />
      <circle cx="10" cy="14" r="1.3" />
    </svg>
  );
}

function AreaListSection({
  title,
  titleColor,
  areas,
  onChange,
  onRemove,
  onAdd,
  onReorder,
  inputStyle,
  emptyMessage,
}: AreaListSectionProps) {
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const emojiStyle: React.CSSProperties = {
    ...inputStyle,
    width: '3rem',
    textAlign: 'center',
    padding: '8px 6px',
    fontSize: '1.05rem',
  };
  const nameStyle: React.CSSProperties = { ...inputStyle, padding: '8px 12px' };
  const timeStyle: React.CSSProperties = {
    ...inputStyle,
    width: '7rem',
    padding: '8px 10px',
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div
      className="flex flex-col gap-3 p-4"
      style={{
        border: '1px solid var(--rule)',
        borderRadius: '12px',
        background: 'var(--white)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      <h3 className="text-sm font-bold tracking-wide" style={{ color: titleColor }}>{title}</h3>
      {areas.length === 0 && (
        <p className="text-xs py-3 text-center" style={{ color: 'var(--ink-3)' }}>
          {emptyMessage}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {areas.map((area, i) => {
          const isDragging = draggingIndex === i;
          const isDropTarget = dragOverIndex === i && draggingIndex !== null && draggingIndex !== i;
          return (
            <div
              key={i}
              onDragOver={(e) => {
                if (draggingIndex === null || draggingIndex === i) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverIndex(i);
              }}
              onDragLeave={() => {
                if (dragOverIndex === i) setDragOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingIndex !== null && draggingIndex !== i) {
                  onReorder(draggingIndex, i);
                }
                setDraggingIndex(null);
                setDragOverIndex(null);
              }}
              className="flex flex-col gap-1.5 p-1.5 rounded-lg transition-all hover:bg-[var(--accent-pale)]"
              style={{
                background: isDropTarget ? 'var(--accent-pale)' : undefined,
                borderTop: isDropTarget && draggingIndex !== null && draggingIndex > i
                  ? `2px solid ${titleColor}`
                  : '2px solid transparent',
                borderBottom: isDropTarget && draggingIndex !== null && draggingIndex < i
                  ? `2px solid ${titleColor}`
                  : '2px solid transparent',
                opacity: isDragging ? 0.4 : 1,
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  draggable
                  onDragStart={(e) => {
                    setDraggingIndex(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                  }}
                  onDragEnd={() => {
                    setDraggingIndex(null);
                    setDragOverIndex(null);
                  }}
                  className="shrink-0 flex items-center justify-center w-6 h-7 rounded transition-colors hover:bg-[var(--bg)]"
                  style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                  aria-label="ドラッグして並び替え"
                  title="ドラッグして並び替え"
                >
                  <GripIcon color="var(--ink-3)" />
                </div>
                <input
                  type="text"
                  value={area.emoji}
                  onChange={(e) => onChange(i, 'emoji', e.target.value)}
                  className="outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                  style={emojiStyle}
                  placeholder="🏠"
                  aria-label="マーク"
                />
                <input
                  type="text"
                  value={area.name}
                  onChange={(e) => onChange(i, 'name', e.target.value)}
                  className="flex-1 min-w-0 outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                  style={nameStyle}
                  placeholder="エリア名"
                  aria-label="エリア名"
                />
                <input
                  type="time"
                  step={AREA_TIME_STEP_SECONDS}
                  value={area.time ?? ''}
                  onChange={(e) => onChange(i, 'time', e.target.value)}
                  className="outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                  style={timeStyle}
                  aria-label="基準時間"
                />
                <button
                  onClick={() => onRemove(i)}
                  className="shrink-0 text-xs px-2 py-2 rounded-md transition-colors hover:bg-[var(--red-pale)]"
                  style={{ color: 'var(--red)' }}
                  aria-label={`${area.name || 'エリア'}を削除`}
                  title="削除"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2 pl-8">
                <span className="shrink-0 text-sm" style={{ color: 'var(--ink-3)' }} aria-hidden>📍</span>
                <input
                  type="text"
                  value={area.address ?? ''}
                  onChange={(e) => onChange(i, 'address', e.target.value)}
                  className="flex-1 min-w-0 outline-none focus:ring-2 focus:ring-[var(--accent)]/30 text-xs"
                  style={{
                    ...inputStyle,
                    padding: '6px 10px',
                    fontSize: '0.8rem',
                  }}
                  placeholder="住所（例: 愛知県大府市吉田町123）— 選択時に自動入力されます"
                  aria-label="エリアの住所"
                />
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="secondary" onClick={onAdd}>+ エリア追加</Button>
    </div>
  );
}
