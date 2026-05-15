'use client';

/**
 * 利用料金表（月次）出力ページ — Phase 66-C
 *
 * - 月選択 → 児童一覧 + 当月イベント列を取得
 * - 各児童について自動計算: 出席日数 / 利用負担額（初期値）/ おやつ / 教材印刷代 / イベント参加（既定 false）
 * - 手動オーバーライド可: 利用負担額 / イベント参加チェック / 受取日
 * - 「保存」で billing_summaries + billing_event_participations を upsert（再印刷時は同じ値）
 * - 「印刷」で A4 横レイアウト
 *
 * PDF 列構成: # / 市町村 / 氏名 / 出席日数 / 利用負担額 / おやつ消耗品代 / 教材印刷代 / 各イベント / 請求額 / 受取日
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { format, getDaysInMonth } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import Button from '@/components/shift-compat/Button';
import { SNACK_FEE_PER_DAY, type CopayTierConst } from '@/lib/constants';
import {
  computeDefaultCopayAmount,
  type BillingChildInput,
  type BillingEventInput,
} from '@/lib/logic/computeBilling';
import { isAttended } from '@/lib/logic/attendance';
import type {
  ChildRow,
  EventRow,
  ScheduleEntryRow,
  CopayTier,
  Facility,
} from '@/lib/types';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
}

type RowState = {
  childId: string;
  childName: string;
  municipality: string | null;
  child: BillingChildInput;
  attendanceDays: number;
  copayAmount: number | null; // null = "—"
  /** 受取（入金）日 YYYY-MM-DD */
  receivedAt: string | null;
  /** event_id → 参加 boolean */
  participations: Record<string, boolean>;
  summaryId: string | null;
  /** ローカルで変更があったか（保存対象判定）*/
  dirty: boolean;
};

interface BillingSummaryRow {
  id: string;
  child_id: string;
  attendance_days: number;
  copay_amount: number | null;
  snack_fee: number;
  kumon_fee: number;
  event_total: number;
  total_amount: number;
  received_at: string | null;
}

function defaultMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

const fmtYen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

export default function BillingFull({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [shiftFacilityId] = useShiftFacilityId();
  const facilityId =
    scope === 'manager' ? me?.facility_id ?? '' : shiftFacilityId ?? '';
  const [{ year, month }, setYM] = useState(() => defaultMonth());
  const [facility, setFacility] = useState<Facility | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const monthFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthTo = `${year}-${String(month).padStart(2, '0')}-${String(getDaysInMonth(new Date(year, month - 1))).padStart(2, '0')}`;

  const loadMe = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (data) setMe(data as MeRow);
  }, [supabase]);

  const fetchAll = useCallback(async () => {
    if (!me || !facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      /* 並列 fetch */
      const [facRes, childRes, eventRes, entryRes, sumRes] = await Promise.all([
        supabase.from('facilities').select('*').eq('id', facilityId).maybeSingle(),
        supabase
          .from('children')
          .select('*')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId)
          .eq('is_active', true)
          .order('display_order', { ascending: true, nullsFirst: false }),
        supabase
          .from('events')
          .select('*')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId)
          .gte('date', monthFrom)
          .lte('date', monthTo)
          .order('date', { ascending: true })
          .order('display_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('schedule_entries')
          .select('id, child_id, date, pickup_time, dropoff_time, attendance_status')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId)
          .gte('date', monthFrom)
          .lte('date', monthTo),
        supabase
          .from('billing_summaries')
          .select('id, child_id, attendance_days, copay_amount, snack_fee, kumon_fee, event_total, total_amount, received_at')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId)
          .eq('year', year)
          .eq('month', month),
      ]);

      setFacility((facRes.data ?? null) as Facility | null);
      const children = (childRes.data ?? []) as ChildRow[];
      const evs = (eventRes.data ?? []) as EventRow[];
      const entries = (entryRes.data ?? []) as Pick<
        ScheduleEntryRow,
        'id' | 'child_id' | 'date' | 'pickup_time' | 'dropoff_time' | 'attendance_status'
      >[];
      const summaries = (sumRes.data ?? []) as BillingSummaryRow[];

      setEvents(evs);

      /* 既存 summary から participations を取得 */
      const summaryIds = summaries.map((s) => s.id);
      const partsByChildId = new Map<string, Map<string, boolean>>();
      if (summaryIds.length > 0) {
        const { data: partsData } = await supabase
          .from('billing_event_participations')
          .select('billing_summary_id, event_id, participated')
          .in('billing_summary_id', summaryIds);
        const sumIdToChildId = new Map(summaries.map((s) => [s.id, s.child_id]));
        for (const p of ((partsData ?? []) as { billing_summary_id: string; event_id: string; participated: boolean }[])) {
          const cid = sumIdToChildId.get(p.billing_summary_id);
          if (!cid) continue;
          if (!partsByChildId.has(cid)) partsByChildId.set(cid, new Map());
          partsByChildId.get(cid)!.set(p.event_id, p.participated);
        }
      }
      const summaryByChildId = new Map(summaries.map((s) => [s.child_id, s]));

      /* 出席日数 / イベント参加初期値: lib/logic/attendance.ts の isAttended に一元化。
         「時間あり ∧ ¬waitlist」だけで判定（absent/leave は時間 NULL に強制されるため自動除外）。 */
      const presentDaysByChildId = new Map<string, number>();
      const attendedSet = new Set<string>();
      const attendedKey = (cid: string, d: string) => `${cid}_${d}`;
      for (const e of entries) {
        if (!isAttended(e)) continue;
        presentDaysByChildId.set(e.child_id, (presentDaysByChildId.get(e.child_id) ?? 0) + 1);
        attendedSet.add(attendedKey(e.child_id, e.date));
      }

      /* row 構築 */
      const newRows: RowState[] = children.map((c) => {
        const childInput: BillingChildInput = {
          childId: c.id,
          gradeType: c.grade_type,
          municipality: c.municipality ?? null,
          copayTier: (c.copay_tier ?? 'zero') as CopayTier,
          copayFreeformAmount: c.copay_freeform_amount ?? null,
          kumonMonthlyFee: c.kumon_monthly_fee ?? null,
        };
        const attendanceDays = presentDaysByChildId.get(c.id) ?? 0;
        const existing = summaryByChildId.get(c.id);
        const initialCopay = existing
          ? existing.copay_amount
          : computeDefaultCopayAmount(childInput, attendanceDays);
        const partsMap = partsByChildId.get(c.id) ?? new Map<string, boolean>();
        const participations: Record<string, boolean> = {};
        for (const ev of evs) {
          if (existing) {
            /* 既存サマリあり: 保存済の participated 値を使用（無ければ false） */
            participations[ev.id] = partsMap.get(ev.id) ?? false;
          } else {
            /* 未保存: 出席判定で初期値（時間あり ∧ 非欠席系の日 = 参加扱い）。
               外したい児童は手動でチェックを外す運用。 */
            participations[ev.id] = attendedSet.has(attendedKey(c.id, ev.date));
          }
        }
        return {
          childId: c.id,
          childName: c.name,
          municipality: c.municipality ?? null,
          child: childInput,
          attendanceDays: existing ? existing.attendance_days : attendanceDays,
          copayAmount: initialCopay,
          receivedAt: existing?.received_at ?? null,
          participations,
          summaryId: existing?.id ?? null,
          /* 新規月＝最初から dirty にして「保存」ボタンを有効化（自動初期値をワンクリックで永続化） */
          dirty: !existing,
        };
      });
      setRows(newRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, me, facilityId, year, month, monthFrom, monthTo]);

  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  /* sticky 列の左オフセットを実測（インライン width は table-layout:auto では hint に過ぎず、
     固定値 left:40/130 を使うとセルの実幅とズレて隙間ができる → 背面のテキストが透ける）。
     ResizeObserver で行方向のリフローを検知して都度更新する。 */
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [stickyLeft, setStickyLeft] = useState({ c2: 40, c3: 130 });
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const measure = () => {
      const headerCells = table.querySelectorAll('thead > tr > th');
      if (headerCells.length < 3) return;
      const w1 = (headerCells[0] as HTMLElement).getBoundingClientRect().width;
      const w2 = (headerCells[1] as HTMLElement).getBoundingClientRect().width;
      setStickyLeft({ c2: Math.round(w1), c3: Math.round(w1 + w2) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    return () => ro.disconnect();
  }, [rows.length, events.length]);

  /* 行の派生値（snack/kumon/event_total/total）*/
  const computed = useMemo(() => {
    return rows.map((r) => {
      const snackFee = Math.max(0, r.attendanceDays) * SNACK_FEE_PER_DAY;
      const kumonFee = r.child.kumonMonthlyFee != null && r.child.kumonMonthlyFee > 0
        ? Math.floor(r.child.kumonMonthlyFee)
        : 0;
      let eventTotal = 0;
      for (const ev of events) {
        if (r.participations[ev.id]) eventTotal += Math.max(0, Math.floor(ev.price));
      }
      const total = (r.copayAmount ?? 0) + snackFee + kumonFee + eventTotal;
      return { childId: r.childId, snackFee, kumonFee, eventTotal, total };
    });
  }, [rows, events]);
  const computedById = useMemo(
    () => new Map(computed.map((c) => [c.childId, c])),
    [computed],
  );

  /* 合計（footer）*/
  const totals = useMemo(() => {
    let attendanceDays = 0;
    let copay = 0;
    let snack = 0;
    let kumon = 0;
    const eventTotals: Record<string, number> = {};
    for (const ev of events) eventTotals[ev.id] = 0;
    let grand = 0;
    for (const r of rows) {
      const c = computedById.get(r.childId);
      if (!c) continue;
      attendanceDays += r.attendanceDays;
      copay += r.copayAmount ?? 0;
      snack += c.snackFee;
      kumon += c.kumonFee;
      for (const ev of events) {
        if (r.participations[ev.id]) eventTotals[ev.id] += Math.max(0, Math.floor(ev.price));
      }
      grand += c.total;
    }
    return { attendanceDays, copay, snack, kumon, eventTotals, grand };
  }, [rows, computedById, events]);

  const updateRow = (childId: string, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.childId === childId ? { ...r, ...patch, dirty: true } : r)));
  };

  const handleToggleEvent = (childId: string, eventId: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.childId === childId
          ? {
              ...r,
              participations: { ...r.participations, [eventId]: !r.participations[eventId] },
              dirty: true,
            }
          : r,
      ),
    );
  };

  const handleSave = async () => {
    if (!me || !facilityId) return;
    setSaving(true);
    setError('');
    try {
      /* 1) billing_summaries upsert（unique: tenant, facility, year, month, child） */
      const summaryRows = rows.map((r) => {
        const c = computedById.get(r.childId);
        return {
          tenant_id: me.tenant_id,
          facility_id: facilityId,
          year,
          month,
          child_id: r.childId,
          attendance_days: r.attendanceDays,
          copay_amount: r.copayAmount,
          snack_fee: c?.snackFee ?? 0,
          kumon_fee: c?.kumonFee ?? 0,
          event_total: c?.eventTotal ?? 0,
          total_amount: c?.total ?? 0,
          received_at: r.receivedAt && r.receivedAt.trim() !== '' ? r.receivedAt : null,
          child_name_snapshot: r.childName,
          child_municipality_snapshot: r.municipality,
          saved_by_employee_id: me.id,
          saved_at: new Date().toISOString(),
        };
      });
      const { data: upserted, error: upErr } = await supabase
        .from('billing_summaries')
        .upsert(summaryRows, { onConflict: 'tenant_id,facility_id,year,month,child_id' })
        .select('id, child_id');
      if (upErr) throw new Error(upErr.message);

      /* 2) billing_event_participations を全置換（このサマリ群のみ）*/
      const childIdToSumId = new Map(((upserted ?? []) as { id: string; child_id: string }[]).map((u) => [u.child_id, u.id]));
      const summaryIds = Array.from(childIdToSumId.values());
      if (summaryIds.length > 0) {
        const { error: delErr } = await supabase
          .from('billing_event_participations')
          .delete()
          .in('billing_summary_id', summaryIds);
        if (delErr) throw new Error(delErr.message);
      }
      const partsToInsert: { billing_summary_id: string; event_id: string; participated: boolean; amount: number }[] = [];
      for (const r of rows) {
        const sid = childIdToSumId.get(r.childId);
        if (!sid) continue;
        for (const ev of events) {
          const participated = !!r.participations[ev.id];
          partsToInsert.push({
            billing_summary_id: sid,
            event_id: ev.id,
            participated,
            amount: participated ? Math.max(0, Math.floor(ev.price)) : 0,
          });
        }
      }
      if (partsToInsert.length > 0) {
        const { error: insErr } = await supabase
          .from('billing_event_participations')
          .insert(partsToInsert);
        if (insErr) throw new Error(insErr.message);
      }
      /* dirty フラグをリセットして再 fetch（id を受け取るため） */
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  function changeMonth(delta: number) {
    setYM(({ year: y, month: m }) => {
      const next = new Date(y, m - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  }

  const dirtyCount = rows.filter((r) => r.dirty).length;

  /* イベント数に応じた印刷密度: 0-4=lg(9pt), 5-7=md(8pt), 8-10=sm(7pt), 11+=xs(6pt) */
  const printDensity =
    events.length <= 4 ? 'lg' :
    events.length <= 7 ? 'md' :
    events.length <= 10 ? 'sm' : 'xs';

  /* ===== render ===== */
  return (
    <div
      className="flex flex-col -m-6 lg:-m-8 p-6 lg:p-8 billing-print-root"
      data-density={printDensity}
    >
      {/* 印刷 CSS + Excel 風グリッド線（縦横全セル枠線） + イベント数に応じた密度自動調整 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            /* Excel 風グリッド: 全セルに枠線、ヘッダ下とフッタ上は太線 */
            .billing-grid th,
            .billing-grid td {
              border: 1px solid var(--rule);
            }
            .billing-grid thead th {
              border-bottom: 2px solid var(--rule-strong);
              border-top: 1px solid var(--rule-strong);
            }
            .billing-grid tbody tr.billing-total-row td {
              border-top: 2px solid var(--rule-strong);
            }
            /* 小学生以下／以上の境目: 二重線（Excel 風）+ 微影で「区切り」を強調 */
            .billing-grid tbody tr.billing-group-divider td {
              border-top: 3px double var(--ink) !important;
              box-shadow: 0 -1px 0 var(--white) inset;
            }
            /* スクリーン表示: 見出し（thead）と先頭3列（# / 市町村 / 氏名）を固定 */
            @media screen {
              .billing-grid thead th {
                position: sticky;
                top: 0;
                background: var(--bg);
                z-index: 2;
              }
              .billing-grid .billing-sticky-col {
                position: sticky;
                background: var(--white);
                z-index: 1;
              }
              .billing-grid thead .billing-sticky-col,
              .billing-grid tbody tr.billing-total-row .billing-sticky-col {
                background: var(--bg);
                z-index: 3;
              }
              .billing-grid .billing-sticky-col-1 { left: 0; }
              .billing-grid .billing-sticky-col-2 { left: var(--sticky-c2, 40px); }
              .billing-grid .billing-sticky-col-3 {
                left: var(--sticky-c3, 130px);
                box-shadow: 1px 0 0 var(--rule-strong);
              }
            }
            @media print {
              /* ユーザー要望: 常に A4 横で出力。イベントが増えても A3 にしない */
              @page { size: A4 landscape; margin: 8mm; }
              .billing-print-root { overflow: visible !important; height: auto !important; padding: 0 !important; margin: 0 !important; }
              .billing-print-root .print-hide { display: none !important; }
              /* スクロール用ラッパーの clip を解除しないとはみ出した部分が切れる */
              .billing-print-root .overflow-x-auto,
              .billing-print-root .overflow-auto {
                overflow: visible !important;
                max-height: none !important;
              }
              /* 印刷時は sticky を解除（PDF 上では普通に流す） */
              .billing-print-root .billing-grid thead th,
              .billing-print-root .billing-grid .billing-sticky-col {
                position: static !important;
                box-shadow: none !important;
              }
              /* table 自体は A4 幅にフィット。インライン min-width / 列幅の px 指定を全て無効化し、
                 table-layout: auto + word-break で内容に応じて 1 ページ幅に収める。 */
              .billing-print-root table { width: 100% !important; min-width: 0 !important; table-layout: auto !important; }
              .billing-print-root thead th,
              .billing-print-root tbody td { width: auto !important; min-width: 0 !important; max-width: none !important; }
              .billing-print-root th, .billing-print-root td { line-height: 1.15 !important; word-break: break-word; overflow-wrap: anywhere; }
              /* whitespace-nowrap が効いていると幅が足りない時に列がはみ出すので、印刷時は折り返し許容 */
              .billing-print-root .whitespace-nowrap { white-space: normal !important; }
              .billing-print-root thead { display: table-header-group !important; }
              .billing-print-root tr { page-break-inside: avoid !important; break-inside: avoid !important; }
              /* イベント増加に応じてフォント・横パディングを段階縮小（A4 横を維持するため）。
                 縦パディングはセル高を確保するため広めに設定。 */
              .billing-print-root[data-density="lg"] table { font-size: 9pt !important; }
              .billing-print-root[data-density="lg"] th,
              .billing-print-root[data-density="lg"] td { padding: 8px 4px !important; }
              .billing-print-root[data-density="md"] table { font-size: 8pt !important; }
              .billing-print-root[data-density="md"] th,
              .billing-print-root[data-density="md"] td { padding: 7px 3px !important; }
              .billing-print-root[data-density="sm"] table { font-size: 7pt !important; }
              .billing-print-root[data-density="sm"] th,
              .billing-print-root[data-density="sm"] td { padding: 6px 2px !important; }
              .billing-print-root[data-density="xs"] table { font-size: 6pt !important; }
              .billing-print-root[data-density="xs"] th,
              .billing-print-root[data-density="xs"] td { padding: 5px 1.5px !important; }
              /* 印刷時もグリッド線を維持（black に切替で印刷時くっきり） */
              .billing-grid th, .billing-grid td { border: 0.5pt solid #000 !important; }
              .billing-grid thead th { border-bottom: 1.2pt solid #000 !important; border-top: 1pt solid #000 !important; }
              .billing-grid tbody tr.billing-total-row td { border-top: 1.2pt solid #000 !important; }
              .billing-grid tbody tr.billing-group-divider td { border-top: 1.5pt double #000 !important; }
              .billing-print-title { display: block !important; }
            }
            @media screen { .billing-print-title { display: none; } }
          `,
        }}
      />

      <h1 className="billing-print-title text-base font-bold mb-2">
        ⑤利用料金表 — {facility?.name ?? ''} {year}年{month}月分
      </h1>

      <div className="flex items-center justify-between flex-wrap gap-3 print-hide mb-3">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
          💰 利用料金表
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => changeMonth(-1)}>‹ 前の月</Button>
          <div
            className="px-3 py-1.5 rounded font-bold whitespace-nowrap"
            style={{ background: 'var(--white)', border: '1.5px solid var(--accent)', color: 'var(--ink)', minWidth: '110px', textAlign: 'center' }}
          >
            {year}年{month}月
          </div>
          <Button variant="secondary" onClick={() => changeMonth(1)}>次の月 ›</Button>
          <Button variant="secondary" onClick={() => window.print()}>🖨 A4横で印刷</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || dirtyCount === 0}>
            {saving ? '保存中…' : dirtyCount > 0 ? `保存（${dirtyCount}件未保存）` : '保存済み'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 rounded mb-2 print-hide" style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {!facilityId ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>事業所が選択されていません。</div>
      ) : loading ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>読み込み中...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>児童が登録されていません。</div>
      ) : (
        <div
          className="overflow-auto rounded border"
          style={{
            borderColor: 'var(--rule-strong)',
            background: 'var(--white)',
            /* main の縦スクロールに乗せるのではなく、この div 内で縦・横ともにスクロールさせる。
               こうすることで sticky thead / sticky 列が main や ancestor の都合に左右されず確実に効く。
               topbar 60 + breadcrumb 約 40 + コンテンツ padding 32 + 月選択 / タイトル行 約 80 = 約 210 を確保。 */
            maxHeight: 'calc(100dvh - 220px)',
          }}
        >
          <table
            ref={tableRef}
            className="w-full text-sm billing-grid"
            style={{
              minWidth: `${600 + events.length * 80}px`,
              borderCollapse: 'collapse',
              ['--sticky-c2' as string]: `${stickyLeft.c2}px`,
              ['--sticky-c3' as string]: `${stickyLeft.c3}px`,
            } as React.CSSProperties}
          >
            {/* Excel 風の縦横線: 全セルに 1px、ヘッダ下線とフッタ上線は太線 */}
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap billing-sticky-col billing-sticky-col-1" style={{ width: '40px' }}>#</th>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap billing-sticky-col billing-sticky-col-2" style={{ width: '90px' }}>市町村</th>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap billing-sticky-col billing-sticky-col-3" style={{ width: '140px' }}>氏名</th>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ width: '70px' }}>出席日数</th>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ width: '110px' }}>利用負担額</th>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ width: '70px' }}>おやつ等</th>
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ width: '90px' }}>教材印刷代</th>
                {events.map((ev) => {
                  /* イベント名が長いと列幅で折り返してしまうので、文字数に応じて自動縮小して 1 行に収める。
                     scaleX 系よりフォントサイズ縮小 + 微妙なトラッキング詰めの方が読みやすい。 */
                  const nameLen = ev.name.length;
                  const nameStyle: React.CSSProperties = {
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontSize:
                      nameLen <= 4 ? '1em' :
                      nameLen <= 6 ? '0.85em' :
                      nameLen <= 8 ? '0.72em' :
                      nameLen <= 10 ? '0.62em' : '0.55em',
                    letterSpacing: nameLen > 6 ? '-0.03em' : undefined,
                    lineHeight: 1.15,
                  };
                  return (
                    <th key={ev.id} className="px-2 py-2 text-center font-semibold" style={{ width: '80px' }}>
                      <div style={nameStyle} title={ev.name}>{ev.name}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                        {format(new Date(ev.date), 'M/d')} ¥{ev.price.toLocaleString('ja-JP')}
                      </div>
                    </th>
                  );
                })}
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ width: '110px' }}>請求額</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const c = computedById.get(r.childId);
                /* 小学生以下（preschool / nursery_3〜5）と それ以上の境目に二重線 */
                const underElem = (g: string) =>
                  g === 'preschool' || g === 'nursery_3' || g === 'nursery_4' || g === 'nursery_5';
                const prev = idx > 0 ? rows[idx - 1] : null;
                const isGroupBoundary =
                  prev != null && underElem(prev.child.gradeType) !== underElem(r.child.gradeType);
                return (
                  <tr key={r.childId} className={isGroupBoundary ? 'billing-group-divider' : ''}>
                    <td className="px-2 py-2 text-center whitespace-nowrap billing-sticky-col billing-sticky-col-1">{idx + 1}</td>
                    <td className="px-2 py-2 whitespace-nowrap billing-sticky-col billing-sticky-col-2">{r.municipality ?? ''}</td>
                    <td className="px-2 py-2 font-semibold whitespace-nowrap billing-sticky-col billing-sticky-col-3">{r.childName}</td>
                    <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.attendanceDays}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={r.copayAmount ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          const n = v === '' ? null : Math.max(0, Math.floor(Number(v)));
                          updateRow(r.childId, {
                            copayAmount: Number.isFinite(n as number) ? n : null,
                          });
                        }}
                        className="outline-none w-full px-2 py-1 rounded text-right print-hide"
                        style={{ background: 'var(--white)', border: '1px solid var(--rule)', fontVariantNumeric: 'tabular-nums' }}
                        placeholder="—"
                      />
                      <span className="hidden print:inline" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {r.copayAmount == null ? '—' : fmtYen(r.copayAmount)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c && c.snackFee > 0 ? fmtYen(c.snackFee) : ''}
                    </td>
                    <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c && c.kumonFee > 0 ? fmtYen(c.kumonFee) : ''}
                    </td>
                    {events.map((ev) => {
                      const participated = !!r.participations[ev.id];
                      return (
                        <td key={ev.id} className="px-2 py-2 text-center">
                          <label className="inline-flex items-center gap-1 cursor-pointer print-hide">
                            <input
                              type="checkbox"
                              checked={participated}
                              onChange={() => handleToggleEvent(r.childId, ev.id)}
                            />
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.78rem', color: participated ? 'var(--ink)' : 'var(--ink-3)' }}>
                              {participated ? fmtYen(ev.price) : '—'}
                            </span>
                          </label>
                          <span className="hidden print:inline" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {participated ? fmtYen(ev.price) : ''}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c ? fmtYen(c.total) : ''}
                    </td>
                  </tr>
                );
              })}
              {/* 合計行 */}
              <tr className="billing-total-row" style={{ background: 'var(--bg)', fontWeight: 700 }}>
                <td colSpan={3} className="px-2 py-2 text-right billing-sticky-col billing-sticky-col-1">合計</td>
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{totals.attendanceDays}</td>
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtYen(totals.copay)}</td>
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtYen(totals.snack)}</td>
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtYen(totals.kumon)}</td>
                {events.map((ev) => (
                  <td key={ev.id} className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtYen(totals.eventTotals[ev.id] ?? 0)}
                  </td>
                ))}
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtYen(totals.grand)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs mt-3 print-hide" style={{ color: 'var(--ink-3)' }}>
        ※ 利用負担額の初期値は児童設定の上限額。デイロボで算出した金額をこの欄に上書きしてください。
        <br />
        ※ イベント参加チェックは初期値 OFF。当月実績に応じてチェックしてください。
        <br />
        ※ 出席日数 = 利用予定で時間が入っている日のカウント（欠席 / お休み / キャンセル待ちは除外）。
        利用表に時間さえ入れれば自動でカウントされます。
      </p>
    </div>
  );
}
