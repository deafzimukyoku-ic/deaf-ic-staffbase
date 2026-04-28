'use client';

/**
 * 利用予定（shift-puzzle schedule/page.tsx 忠実移植）
 * - 児童 × 日付グリッド
 * - セルクリック → 編集モーダル（時間 + 自/迎送 トグル + 出欠ボタン3種）
 * - PDF/Excel インポート（後続ターンで実装、現在はボタン無効）
 * - 月ステッパー、印刷
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format, getDaysInMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/shift-compat/Button';
import Modal from '@/components/shift-compat/Modal';
import { GRADE_LABELS } from '@/lib/shift-utils';
import ScheduleGridFull, { type ScheduleCellData } from '@/components/shift/ScheduleGridFull';
import PdfImportModal from '@/components/shift/PdfImportModal';
import ExcelPasteModal, { type ExistingEntrySummary } from '@/components/shift/ExcelPasteModal';
import { useShiftFacilityId } from '@/lib/shift-facility';
import type { ChildRow, ScheduleEntryRow, AttendanceStatus, AttendanceAuditLogRow, Facility, AreaLabel, ParsedScheduleEntry } from '@/lib/types';
import { inferChildDefaultTimes } from '@/lib/logic/inferDefaultTimes';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
  last_name: string | null;
  first_name: string | null;
}

function ToggleGroup({
  options,
  value,
  onChange,
  accentColor = 'var(--accent)',
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  accentColor?: string;
}) {
  return (
    <div className="flex gap-0">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="px-4 py-2 text-sm font-semibold transition-all first:rounded-l-md last:rounded-r-md"
          style={{
            background: value === opt.value ? accentColor : 'var(--bg)',
            color: value === opt.value ? '#ffffff' : 'var(--ink-2)',
            border: `1px solid ${value === opt.value ? accentColor : 'var(--rule-strong)'}`,
            marginLeft: opt.value === options[0].value ? '0' : '-1px',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  planned: '予定',
  present: '出席',
  absent: '欠席',
  late: '遅刻',
  early_leave: '早退',
  leave: 'お休み',
  waitlist: 'キャンセル待ち',
};

const WAITLIST_MARKS = '①②③④⑤⑥⑦⑧⑨⑩';

function defaultCurrentMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function ScheduleFull({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [shiftFacilityId, setShiftFacilityId] = useShiftFacilityId();
  // 自分の facility_id（manager は固定）。admin は上部ヘッダーの shiftFacilityId に従う。
  const selectedFacilityId =
    scope === 'manager'
      ? (me?.facility_id ?? '')
      : (shiftFacilityId ?? '');
  const [{ year, month }, setYM] = useState(() => defaultCurrentMonth());

  const [children, setChildren] = useState<ChildRow[]>([]);
  const [cells, setCells] = useState<ScheduleCellData[]>([]);
  const [rawEntries, setRawEntries] = useState<ScheduleEntryRow[]>([]);
  const [pickupAreas, setPickupAreas] = useState<AreaLabel[]>([]);
  const [dropoffAreas, setDropoffAreas] = useState<AreaLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // PDF/Excel インポートモーダル
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [excelModalOpen, setExcelModalOpen] = useState(false);

  // セル編集モーダル
  const [selectedCell, setSelectedCell] = useState<{ childId: string; date: string } | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>('planned');
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceAuditLogRow[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  // Phase 64: キャンセル待ちの順番（1〜10、null = 未指定）
  const [waitlistOrder, setWaitlistOrder] = useState<number | null>(null);
  const [pickupHour, setPickupHour] = useState('13');
  const [pickupMin, setPickupMin] = useState('20');
  const [pickupMethod, setPickupMethod] = useState<'self' | 'pickup'>('pickup');
  const [dropoffHour, setDropoffHour] = useState('16');
  const [dropoffMin, setDropoffMin] = useState('00');
  const [dropoffMethod, setDropoffMethod] = useState<'self' | 'dropoff'>('dropoff');

  const loadBasics = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: meRow } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id, last_name, first_name')
      .eq('auth_user_id', user.id)
      .single();
    if (!meRow) return;
    setMe(meRow);

    /* 初期化は (admin)/(manager)/layout.tsx に集約済み。
       useShiftFacilityId は最初の render で null を返すため、ここで fallback set すると
       layout が決めた値（自分の所属 or ユーザー切替値）を不正に上書きしてしまう。
       fallback は削除した。 */
  }, [supabase, scope, shiftFacilityId, setShiftFacilityId]);

  const fetchAll = useCallback(async () => {
    if (!me || !selectedFacilityId) return;
    setLoading(true);
    setError('');
    try {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = getDaysInMonth(new Date(year, month - 1));
      const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const { data: childData } = await supabase
        .from('children')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .eq('facility_id', selectedFacilityId)
        .eq('is_active', true)
        .order('display_order', { ascending: true, nullsFirst: false });
      const ch = ((childData ?? []) as ChildRow[]);

      const { data: entriesData } = await supabase
        .from('schedule_entries')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .eq('facility_id', selectedFacilityId)
        .gte('date', from)
        .lte('date', to);
      const entries = ((entriesData ?? []) as ScheduleEntryRow[]);

      // facility のエリアラベル（PDFインポートのマーク推論用）
      const { data: fs } = await supabase
        .from('facility_shift_settings')
        .select('pickup_area_labels, dropoff_area_labels')
        .eq('facility_id', selectedFacilityId)
        .maybeSingle();
      setPickupAreas(Array.isArray(fs?.pickup_area_labels) ? fs!.pickup_area_labels : []);
      setDropoffAreas(Array.isArray(fs?.dropoff_area_labels) ? fs!.dropoff_area_labels : []);

      setChildren(ch);
      setRawEntries(entries);
      setCells(
        entries.map<ScheduleCellData>((e) => ({
          entry_id: e.id,
          child_id: e.child_id,
          date: e.date,
          pickup_time: e.pickup_time,
          dropoff_time: e.dropoff_time,
          pickup_method: e.pickup_method === 'self' ? 'self' : 'pickup',
          dropoff_method: e.dropoff_method === 'self' ? 'self' : 'dropoff',
          attendance_status: e.attendance_status ?? 'planned',
          waitlist_order: e.waitlist_order ?? null,
          note: e.note ?? null,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, me, selectedFacilityId, year, month]);

  useEffect(() => { loadBasics().then(() => setLoading(false)); }, [loadBasics]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const childrenForGrid = useMemo(() => children.map((c) => ({
    id: c.id,
    name: c.name,
    grade_label: GRADE_LABELS[c.grade_type] ?? '',
  })), [children]);

  const handleCellClick = (childId: string, date: string) => {
    const cellData = cells.find((c) => c.child_id === childId && c.date === date);
    /* Phase 66+: 空セル時は同児童 × 同日タイプ（平日 / 土日祝）の最頻値を初期値に。
       既存の rawEntries から推定。データが無ければ 13:00 / 16:00 にフォールバック。 */
    const inferred =
      !cellData?.pickup_time || !cellData?.dropoff_time
        ? inferChildDefaultTimes(childId, date, rawEntries)
        : { pickup: null, dropoff: null };

    if (cellData?.pickup_time) {
      const [h, m] = cellData.pickup_time.split(':');
      setPickupHour(h); setPickupMin(m);
    } else if (inferred.pickup) {
      const [h, m] = inferred.pickup.split(':');
      setPickupHour(h); setPickupMin(m);
    } else {
      setPickupHour('13'); setPickupMin('00');
    }
    if (cellData?.dropoff_time) {
      const [h, m] = cellData.dropoff_time.split(':');
      setDropoffHour(h); setDropoffMin(m);
    } else if (inferred.dropoff) {
      const [h, m] = inferred.dropoff.split(':');
      setDropoffHour(h); setDropoffMin(m);
    } else {
      setDropoffHour('16'); setDropoffMin('00');
    }
    setPickupMethod(cellData?.pickup_method || 'pickup');
    setDropoffMethod(cellData?.dropoff_method || 'dropoff');
    setAttendanceStatus(cellData?.attendance_status ?? 'planned');
    setWaitlistOrder(cellData?.waitlist_order ?? null);
    setAttendanceLogs([]);
    setLogsOpen(false);
    setSelectedCell({ childId, date });
  };

  const handleAttendanceChange = async (
    next: AttendanceStatus,
    nextOrder: number | null = null,
  ) => {
    if (!selectedCell || !me) return;
    const cell = cells.find(
      (c) => c.child_id === selectedCell.childId && c.date === selectedCell.date,
    );
    /* Phase 64: waitlist 以外なら順番は強制 NULL（DB CHECK 制約と整合） */
    const orderToSend = next === 'waitlist' ? nextOrder : null;
    setAttendanceBusy(true);
    try {
      let entryId = cell?.entry_id ?? null;

      // 空セルなら entry を空で作成
      if (!entryId) {
        const child = children.find((c) => c.id === selectedCell.childId);
        if (!child) throw new Error('児童が見つかりません');
        const { data: inserted, error: insErr } = await supabase
          .from('schedule_entries')
          .upsert({
            tenant_id: me.tenant_id,
            facility_id: child.facility_id,
            child_id: selectedCell.childId,
            date: selectedCell.date,
            pickup_time: null,
            dropoff_time: null,
            pickup_method: 'pickup',
            dropoff_method: 'dropoff',
          }, { onConflict: 'tenant_id,facility_id,child_id,date' })
          .select('id')
          .single();
        if (insErr) throw new Error(insErr.message);
        entryId = inserted?.id ?? null;
        if (!entryId) throw new Error('利用予定の作成に失敗しました');
      }

      // RPC update_schedule_entry_attendance を呼ぶ（migration 124 で第3引数 p_waitlist_order 追加）
      const { error: rpcErr } = await supabase.rpc('update_schedule_entry_attendance', {
        p_entry_id: entryId,
        p_status: next,
        p_waitlist_order: orderToSend,
      });
      if (rpcErr) {
        // RPC が無い/失敗時は直接 update
        const { error: upErr } = await supabase
          .from('schedule_entries')
          .update({
            attendance_status: next,
            waitlist_order: orderToSend,
            attendance_updated_at: new Date().toISOString(),
            attendance_updated_by: me.id,
          })
          .eq('id', entryId);
        if (upErr) throw new Error(upErr.message);
      }

      setAttendanceStatus(next);
      setWaitlistOrder(orderToSend);
      const finalEntryId = entryId;
      setCells((prev) => {
        const exists = prev.some((c) => c.entry_id === finalEntryId);
        if (exists) {
          return prev.map((c) =>
            c.entry_id === finalEntryId
              ? { ...c, attendance_status: next, waitlist_order: orderToSend }
              : c,
          );
        }
        void fetchAll();
        return prev;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : '更新失敗');
    } finally {
      setAttendanceBusy(false);
    }
  };

  // PDF/Excel インポートからの一括登録
  const handleBulkImport = async (entries: ParsedScheduleEntry[]) => {
    if (!me) return;
    const nameToChild = new Map(children.map((c) => [c.name, c]));
    const rows = entries
      .filter((e) => nameToChild.has(e.child_name))
      .map((e) => {
        const child = nameToChild.get(e.child_name)!;
        return {
          tenant_id: me.tenant_id,
          facility_id: child.facility_id,
          child_id: child.id,
          date: e.date,
          pickup_time: e.pickup_time ? `${e.pickup_time}:00` : null,
          dropoff_time: e.dropoff_time ? `${e.dropoff_time}:00` : null,
          pickup_method: (e.pickup_method ?? 'pickup') as 'self' | 'pickup',
          dropoff_method: (e.dropoff_method ?? 'dropoff') as 'self' | 'dropoff',
          pickup_mark: e.pickup_mark ?? null,
          dropoff_mark: e.dropoff_mark ?? null,
          note: e.area_label && (e.area_label === '追・休' || e.area_label === '定・休')
            ? e.area_label
            : null,
        };
      });

    const skipped = entries.length - rows.length;

    if (rows.length === 0) {
      alert('児童名が一致しませんでした。児童管理で名前を登録してください。');
      return;
    }

    const { error: upErr } = await supabase
      .from('schedule_entries')
      .upsert(rows, { onConflict: 'tenant_id,facility_id,child_id,date' });

    if (upErr) {
      alert('インポートに失敗しました: ' + upErr.message);
      return;
    }

    alert(
      skipped > 0
        ? `${rows.length}件を反映しました（${skipped}件は児童名未登録のためスキップ）`
        : `${rows.length}件の利用予定を登録しました`
    );
    await fetchAll();
  };

  const handleSave = async () => {
    if (!selectedCell || !me) return;
    /* Phase 64: waitlist は時刻保持（present 昇格時に引き継ぐため）。absent/leave は時刻 NULL。 */
    const isPresent =
      attendanceStatus !== 'absent' &&
      attendanceStatus !== 'leave';
    const pickup = isPresent
      ? `${pickupHour.padStart(2, '0')}:${pickupMin.padStart(2, '0')}`
      : null;
    const dropoff = isPresent
      ? `${dropoffHour.padStart(2, '0')}:${dropoffMin.padStart(2, '0')}`
      : null;

    try {
      const child = children.find((c) => c.id === selectedCell.childId);
      if (!child) throw new Error('児童が見つかりません');
      const { error: upErr } = await supabase
        .from('schedule_entries')
        .upsert({
          tenant_id: me.tenant_id,
          facility_id: child.facility_id,
          child_id: selectedCell.childId,
          date: selectedCell.date,
          pickup_time: pickup ? `${pickup}:00` : null,
          dropoff_time: dropoff ? `${dropoff}:00` : null,
          pickup_method: pickupMethod,
          dropoff_method: dropoffMethod,
        }, { onConflict: 'tenant_id,facility_id,child_id,date' });
      if (upErr) throw new Error(upErr.message);
      setSelectedCell(null);
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失敗');
    }
  };

  const selectedChild = selectedCell ? children.find((c) => c.id === selectedCell.childId) : null;
  const formatDateLabel = (dateStr: string) => format(new Date(dateStr), 'M月d日（E）', { locale: ja });

  const timeInputStyle: React.CSSProperties = {
    width: '60px', padding: '8px 4px', fontSize: '1.1rem', fontWeight: 600,
    textAlign: 'center', color: 'var(--ink)', background: 'transparent',
    border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none',
  };

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', color: 'var(--ink)',
    border: '1px solid var(--rule)', borderRadius: '6px',
    padding: '6px 10px', fontSize: '0.85rem',
  };

  function changeMonth(delta: number) {
    setYM(({ year: y, month: m }) => {
      const next = new Date(y, m - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  }

  function thisMonth() {
    setYM(defaultCurrentMonth());
  }

  return (
    <div className="flex flex-col h-full overflow-hidden schedule-print-root -m-6 lg:-m-8">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A3 landscape; margin: 5mm; }
              .schedule-print-root { overflow: visible !important; height: auto !important; }
              .schedule-print-root .flex-1 { overflow: visible !important; padding: 0 !important; }
              .schedule-print-root table { font-size: 6.5pt !important; width: 100% !important; min-width: 0 !important; table-layout: fixed !important; border-collapse: collapse !important; }
              .schedule-print-root table, .schedule-print-root thead, .schedule-print-root tbody, .schedule-print-root tr { page-break-inside: avoid !important; break-inside: avoid !important; }
              .schedule-print-root th, .schedule-print-root td { min-width: 0 !important; padding: 0 1px !important; font-size: 6.5pt !important; line-height: 1.05 !important; overflow: hidden; }
              .schedule-print-root tbody td:first-child > div:nth-child(2) { display: none !important; }
              .schedule-print-root tbody td .flex.flex-col { flex-direction: row !important; flex-wrap: wrap !important; gap: 0 4px !important; line-height: 1.0 !important; }
              .schedule-print-root tbody td .flex.flex-col > span { white-space: nowrap !important; font-size: 6pt !important; }
              .schedule-print-root thead th > div:first-child, .schedule-print-root thead th > div:last-child { display: none !important; }
              .schedule-print-root tbody tr { height: 16px !important; }
              .schedule-print-root thead th:first-child, .schedule-print-root tbody td:first-child { width: 60px !important; min-width: 60px !important; padding: 0 3px !important; }
              .schedule-print-title { display: block !important; font-size: 11pt; font-weight: 700; margin-bottom: 2mm; }
            }
            @media screen { .schedule-print-title { display: none; } }
          `,
        }}
      />
      <h1 className="schedule-print-title print-only">{year}年{month}月 利用表</h1>

      {/* 月ステッパー + アクション。スタイルは MonthStepper / 添付画像と統一 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-1 pb-1.5">
        <div className="inline-flex items-center gap-1.5 flex-wrap" role="group" aria-label="対象月">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="w-8 h-8 inline-flex items-center justify-center text-sm font-semibold transition-colors"
            style={{ background: 'var(--white)', color: 'var(--ink-2)', border: '1px solid var(--rule)', borderRadius: '6px' }}
            title="前の月"
            aria-label="前の月"
          >
            ‹
          </button>
          <div
            className="inline-flex items-center gap-2 font-bold"
            style={{
              color: 'var(--ink)',
              background: 'var(--white)',
              border: '1.5px solid var(--accent)',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '0.95rem',
              minWidth: '110px',
              justifyContent: 'center',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <span>{year}年{month}月</span>
            {(() => {
              const now = new Date();
              const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
              return isCurrent ? (
                <span
                  aria-hidden
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    boxShadow: '0 0 0 2px var(--accent-pale)',
                  }}
                />
              ) : null;
            })()}
          </div>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="w-8 h-8 inline-flex items-center justify-center text-sm font-semibold transition-colors"
            style={{ background: 'var(--white)', color: 'var(--ink-2)', border: '1px solid var(--rule)', borderRadius: '6px' }}
            title="次の月"
            aria-label="次の月"
          >
            ›
          </button>
          {(() => {
            const now = new Date();
            const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
            return !isCurrent ? (
              <button
                type="button"
                onClick={thisMonth}
                className="text-xs font-semibold px-2.5 py-1.5 rounded transition-colors"
                style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                title="今月へジャンプ"
              >
                今月へ
              </button>
            ) : null;
          })()}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => window.print()}
            className="h-11 w-11 flex items-center justify-center rounded-md text-xl transition-all hover:bg-[var(--accent-pale)]"
            style={{ background: 'var(--white)', color: 'var(--ink-2)', border: '1px solid var(--rule-strong)' }}
            title="A3 横で印刷"
            aria-label="印刷"
          >
            🖨
          </button>
          <button
            type="button"
            onClick={() => setExcelModalOpen(true)}
            className="h-11 w-11 flex items-center justify-center rounded-md text-xl transition-all hover:bg-[var(--accent-pale)]"
            style={{ background: 'var(--white)', color: 'var(--ink-2)', border: '1px solid var(--rule-strong)' }}
            title="Excel貼付"
            aria-label="Excel貼付"
          >
            📋
          </button>
          <button
            type="button"
            onClick={() => setPdfModalOpen(true)}
            className="h-11 px-4 flex items-center justify-center gap-1.5 rounded-md text-sm font-bold transition-all hover:opacity-90 whitespace-nowrap"
            style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
            title="PDFインポート"
          >
            📄 PDF
          </button>
        </div>
      </div>

      <div className="px-2 flex-1 overflow-hidden flex flex-col">
        {error && (
          <div className="mb-2 px-4 py-2 rounded" style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}
        {loading ? (
          <div className="h-96 flex items-center justify-center text-sm" style={{ color: 'var(--ink-3)' }}>
            読み込み中...
          </div>
        ) : children.length === 0 ? (
          <div className="h-96 flex items-center justify-center text-sm" style={{ color: 'var(--ink-3)' }}>
            児童が登録されていません。児童管理から追加してください。
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <ScheduleGridFull
              year={year}
              month={month}
              children={childrenForGrid}
              cells={cells}
              onCellClick={handleCellClick}
            />
          </div>
        )}
      </div>

      <PdfImportModal
        isOpen={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        onConfirm={handleBulkImport}
        childList={children}
        pickupAreas={pickupAreas}
        dropoffAreas={dropoffAreas}
      />

      {me && (
        <ExcelPasteModal
          isOpen={excelModalOpen}
          onClose={() => setExcelModalOpen(false)}
          onConfirm={handleBulkImport}
          year={year}
          month={month}
          tenantId={me.tenant_id}
          facilityId={selectedFacilityId}
          existingChildNames={children.map((c) => c.name)}
          onChildrenRegistered={fetchAll}
          existingEntries={rawEntries.map<ExistingEntrySummary>((e) => ({
            id: e.id,
            child_id: e.child_id,
            date: e.date,
            pickup_time: e.pickup_time,
            dropoff_time: e.dropoff_time,
            pickup_method: e.pickup_method === 'self' ? 'self' : 'pickup',
            dropoff_method: e.dropoff_method === 'self' ? 'self' : 'dropoff',
            pickup_mark: e.pickup_mark ?? null,
            dropoff_mark: e.dropoff_mark ?? null,
          }))}
          childNameToId={new Map(children.map((c) => [c.name, c.id]))}
        />
      )}

      <Modal
        isOpen={!!selectedCell}
        onClose={() => setSelectedCell(null)}
        title={selectedCell && selectedChild ? `${selectedChild.name} — ${formatDateLabel(selectedCell.date)}` : ''}
      >
        {selectedCell && selectedChild && (
          <div className="flex flex-col gap-5">
            {attendanceStatus !== 'absent' && attendanceStatus !== 'leave' && (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink-2)' }}>
                    来所予定時間
                    {pickupMethod === 'self' && (
                      <span className="text-xs font-normal" style={{ color: 'var(--ink-3)' }}>（送迎なし）</span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={23} value={pickupHour} onChange={(e) => setPickupHour(e.target.value)} style={timeInputStyle} />
                    <span className="text-lg font-bold" style={{ color: 'var(--ink-3)' }}>:</span>
                    <input type="number" min={0} max={59} step={5} value={pickupMin} onChange={(e) => setPickupMin(e.target.value)} style={timeInputStyle} />
                  </div>
                  <ToggleGroup
                    options={[{ label: '自分で来る', value: 'self' }, { label: 'お迎え', value: 'pickup' }]}
                    value={pickupMethod}
                    onChange={(v) => setPickupMethod(v as 'self' | 'pickup')}
                    accentColor="#4dbfbf"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink-2)' }}>
                    退所予定時間
                    {dropoffMethod === 'self' && (
                      <span className="text-xs font-normal" style={{ color: 'var(--ink-3)' }}>（送迎なし）</span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={23} value={dropoffHour} onChange={(e) => setDropoffHour(e.target.value)} style={timeInputStyle} />
                    <span className="text-lg font-bold" style={{ color: 'var(--ink-3)' }}>:</span>
                    <input type="number" min={0} max={59} step={5} value={dropoffMin} onChange={(e) => setDropoffMin(e.target.value)} style={timeInputStyle} />
                  </div>
                  <ToggleGroup
                    options={[{ label: '自分で帰る', value: 'self' }, { label: '送り', value: 'dropoff' }]}
                    value={dropoffMethod}
                    onChange={(v) => setDropoffMethod(v as 'self' | 'dropoff')}
                    accentColor="#4dbfbf"
                  />
                </div>
              </>
            )}

            {attendanceStatus === 'waitlist' && (
              <div
                className="px-3 py-2 rounded text-xs font-semibold"
                style={{
                  background: 'rgba(0,0,0,0.05)',
                  color: 'var(--ink-2)',
                  border: '1px dashed var(--rule-strong)',
                }}
              >
                この利用時間でキャンセル待ちです
                {waitlistOrder ? `（順番: ${waitlistOrder} 番）` : ''}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-3 mt-1" style={{ borderTop: '1px solid var(--rule)' }}>
              {/* deaf-ic 仕様: 時間が入っていれば自動で出席扱い。
                  「お休み / 欠席 / キャンセル待ち」のみマーク。各ボタンはトグル（再押下で予定に戻す）。 */}
              <div
                className="text-xs px-3 py-2 rounded"
                style={{ background: 'var(--green-pale)', color: 'var(--green)', border: '1px solid rgba(42,122,82,0.3)' }}
              >
                ✓ 時間が入っていれば自動で出席扱いになります。下のボタンは欠席連絡などがあった時のみ押してください。
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { label: 'お休み', value: 'leave' as AttendanceStatus, color: 'var(--ink-3)' },
                  { label: '欠席', value: 'absent' as AttendanceStatus, color: 'var(--red)' },
                  { label: 'キャンセル待ち', value: 'waitlist' as AttendanceStatus, color: '#6b7280' },
                ]).map((opt) => {
                  const on = attendanceStatus === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={attendanceBusy}
                      onClick={() => {
                        if (on) {
                          /* トグル解除: 同じボタンを再度押したら planned に戻す（=出席扱いに戻る） */
                          handleAttendanceChange('planned', null);
                          return;
                        }
                        /* waitlist に切替時は既存 order を維持、それ以外は null */
                        const carryOrder = opt.value === 'waitlist' ? waitlistOrder : null;
                        handleAttendanceChange(opt.value, carryOrder);
                      }}
                      className="py-3 text-sm font-bold rounded transition-all"
                      style={{
                        background: on ? opt.color : 'var(--bg)',
                        color: on ? '#fff' : 'var(--ink-2)',
                        border: `2px solid ${on ? opt.color : 'var(--rule-strong)'}`,
                        opacity: attendanceBusy ? 0.6 : 1,
                        cursor: attendanceBusy ? 'wait' : 'pointer',
                      }}
                      title={on ? 'もう一度押すと予定に戻します（出席扱い）' : undefined}
                    >
                      {opt.label}{on ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>

              {/* Phase 64: キャンセル待ちの順番ピッカー（5×2 グリッド、同番号重複可） */}
              {attendanceStatus === 'waitlist' && (
                <div className="flex flex-col gap-2 mt-2">
                  <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                    順番（同じ番号が複数いてもOK：兄弟など）
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                      const on = waitlistOrder === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          disabled={attendanceBusy}
                          onClick={() => handleAttendanceChange('waitlist', n)}
                          className="py-2 text-base font-bold rounded transition-all"
                          style={{
                            background: on ? '#6b7280' : 'var(--bg)',
                            color: on ? '#fff' : 'var(--ink-2)',
                            border: `2px solid ${on ? '#6b7280' : 'var(--rule-strong)'}`,
                            opacity: attendanceBusy ? 0.6 : 1,
                            cursor: attendanceBusy ? 'wait' : 'pointer',
                          }}
                        >
                          {WAITLIST_MARKS.charAt(n - 1)}
                        </button>
                      );
                    })}
                  </div>
                  {waitlistOrder != null && (
                    <button
                      type="button"
                      onClick={() => handleAttendanceChange('waitlist', null)}
                      disabled={attendanceBusy}
                      className="text-xs font-semibold py-1.5 rounded"
                      style={{
                        background: 'transparent',
                        color: 'var(--ink-3)',
                        border: '1px dashed var(--rule-strong)',
                      }}
                    >
                      順番をクリア
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-2">
              <Button variant="secondary" onClick={() => setSelectedCell(null)}>キャンセル</Button>
              <Button variant="primary" onClick={handleSave}>保存</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
