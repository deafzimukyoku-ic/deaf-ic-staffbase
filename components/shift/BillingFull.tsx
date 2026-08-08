'use client';

/**
 * 利用料金表（月次）出力ページ — Phase 66-C / migration 222・223 で請求項目を可変化
 *
 * - 月選択 → 児童一覧 + 当月イベント列 + 請求項目列 を取得
 * - 各児童について自動計算: 出席日数 / 利用負担額（初期値）/ 各請求項目 / 参加費合計 / 請求額
 * - 請求項目（おやつ等・教材印刷代・他施設利用 等）は `billing_fee_items` のマスタから動的に列を生成する。
 *   計算方式ごとの UI:
 *     per_day / monthly_fixed … ▲▼ で調整（調整するとその月は固定）+ ↺ で自動に戻す
 *     checkbox               … チェック ON で加算（他施設利用）
 *     per_child_monthly      … 児童設定の金額を読み取り専用表示
 * - イベント参加は「保存済みの明示値があればそれ、無ければ利用表の出席実績」で初期化する。
 *   保存済みの値は自動で書き換えず、利用表とズレている場合のみ警告 + 一括で揃えるボタンを出す
 * - 列順（先方要望 2026-08-08）:
 *     # / 市町村 / 氏名 / 出席日数 / 利用負担額 / 【常時かかる項目】/ 各イベント /
 *     参加費合計 / 【チェック型の項目（他施設利用など）】/ 請求額 / 兄弟
 *   チェック型は「その月だけ発生する追加費用」なので、性質の近い参加費合計の右へ寄せる。
 * - 兄弟グループの児童は隣接表示し、グループ直下に「きょうだい合計」行を出す。
 *   **各児童の行は個別金額のまま**で、全体合計には児童行のみを足す（小計を足すと二重計上になる）
 * - 参加費合計 (eventTotal) は別列で表示するが、請求額にも含む
 * - 「保存」で billing_summaries + billing_event_participations + billing_summary_fee_amounts を upsert
 * - 「印刷」で A4 横レイアウト
 */

import { Fragment, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { format, getDaysInMonth } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import Button from '@/components/shift-compat/Button';
import {
  computeBillingRow,
  computeDefaultCopayAmount,
  computeDefaultFeeAmount,
  computeSiblingSubtotals,
  isFeeOverridable,
  resolveFeeAmount,
  stepFeeAmount,
  EMPTY_FEE_VALUE,
  type BillingChildInput,
  type BillingFeeItemInput,
  type BillingFeeValueInput,
} from '@/lib/logic/computeBilling';
import { isAttended } from '@/lib/logic/attendance';
import type {
  BillingFeeItemRow,
  ChildRow,
  CopayTier,
  EventRow,
  Facility,
  ScheduleEntryRow,
  SiblingGroupRow,
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
  siblingGroupId: string | null;
  attendanceDays: number;
  copayAmount: number | null; // null = "—"
  /** fee_item_id → その児童のその月の値（チェック / 手動調整 / 児童別月額） */
  feeValues: Record<string, BillingFeeValueInput>;
  /** 受取（入金）日 YYYY-MM-DD */
  receivedAt: string | null;
  /** event_id → 参加 boolean */
  participations: Record<string, boolean>;
  /** event_id → その日に利用表で出席実績があるか。participations とのズレ検出用（保存対象ではない） */
  attendedByEvent: Record<string, boolean>;
  summaryId: string | null;
  /** ローカルで変更があったか（保存対象判定）*/
  dirty: boolean;
};

interface BillingSummaryRow {
  id: string;
  child_id: string;
  attendance_days: number;
  copay_amount: number | null;
  received_at: string | null;
}

interface FeeAmountRow {
  billing_summary_id: string;
  fee_item_id: string;
  checked: boolean;
  amount_override: number | null;
}

function defaultMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

const fmtYen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

/* 請求項目セル内の小型ステッパー。shadcn の Button はセル内には大きすぎるため素の button を使う。
   タップ標的 24px を確保（モバイルで押せる最小サイズ）。 */
const feeBtnStyle: React.CSSProperties = {
  width: '24px',
  height: '24px',
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
  border: '1px solid var(--rule)',
  background: 'var(--white)',
  color: 'var(--ink)',
  fontSize: '0.7rem',
  cursor: 'pointer',
  flexShrink: 0,
};

export default function BillingFull({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [shiftFacilityId] = useShiftFacilityId();
  const facilityId =
    scope === 'manager' ? me?.facility_id ?? '' : shiftFacilityId ?? '';
  const [{ year, month }, setYM] = useState(() => defaultMonth());
  const [facility, setFacility] = useState<Facility | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [feeItems, setFeeItems] = useState<BillingFeeItemRow[]>([]);
  const [siblingGroups, setSiblingGroups] = useState<SiblingGroupRow[]>([]);
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
      const [facRes, childRes, eventRes, entryRes, sumRes, itemRes, cfaRes, sgRes] = await Promise.all([
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
          .select('id, child_id, attendance_days, copay_amount, received_at')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId)
          .eq('year', year)
          .eq('month', month),
        /* 請求項目マスタ。is_active=false は以後の月の列から外す（過去月のスナップショットは残る） */
        supabase
          .from('billing_fee_items')
          .select('*')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId)
          .eq('is_active', true)
          .order('display_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('children_fee_amounts')
          .select('child_id, fee_item_id, amount')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId),
        supabase
          .from('sibling_groups')
          .select('*')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId),
      ]);

      setFacility((facRes.data ?? null) as Facility | null);
      const children = (childRes.data ?? []) as ChildRow[];
      const evs = (eventRes.data ?? []) as EventRow[];
      const entries = (entryRes.data ?? []) as Pick<
        ScheduleEntryRow,
        'id' | 'child_id' | 'date' | 'pickup_time' | 'dropoff_time' | 'attendance_status'
      >[];
      const summaries = (sumRes.data ?? []) as BillingSummaryRow[];
      const items = (itemRes.data ?? []) as BillingFeeItemRow[];
      const childAmounts = (cfaRes.data ?? []) as { child_id: string; fee_item_id: string; amount: number }[];

      setEvents(evs);
      setFeeItems(items);
      setSiblingGroups((sgRes.data ?? []) as SiblingGroupRow[]);

      /* 既存 summary から participations と請求項目の値を取得 */
      const summaryIds = summaries.map((s) => s.id);
      const partsByChildId = new Map<string, Map<string, boolean>>();
      const feesByChildId = new Map<string, Map<string, FeeAmountRow>>();
      if (summaryIds.length > 0) {
        const sumIdToChildId = new Map(summaries.map((s) => [s.id, s.child_id]));
        const [partsRes, feeRes] = await Promise.all([
          supabase
            .from('billing_event_participations')
            .select('billing_summary_id, event_id, participated')
            .in('billing_summary_id', summaryIds),
          supabase
            .from('billing_summary_fee_amounts')
            .select('billing_summary_id, fee_item_id, checked, amount_override')
            .in('billing_summary_id', summaryIds),
        ]);
        for (const p of ((partsRes.data ?? []) as { billing_summary_id: string; event_id: string; participated: boolean }[])) {
          const cid = sumIdToChildId.get(p.billing_summary_id);
          if (!cid) continue;
          if (!partsByChildId.has(cid)) partsByChildId.set(cid, new Map());
          partsByChildId.get(cid)!.set(p.event_id, p.participated);
        }
        for (const f of ((feeRes.data ?? []) as FeeAmountRow[])) {
          const cid = sumIdToChildId.get(f.billing_summary_id);
          if (!cid) continue;
          if (!feesByChildId.has(cid)) feesByChildId.set(cid, new Map());
          feesByChildId.get(cid)!.set(f.fee_item_id, f);
        }
      }
      const summaryByChildId = new Map(summaries.map((s) => [s.child_id, s]));
      const childAmountByKey = new Map(childAmounts.map((a) => [`${a.child_id}|${a.fee_item_id}`, a.amount]));

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
        };
        const attendanceDays = presentDaysByChildId.get(c.id) ?? 0;
        const existing = summaryByChildId.get(c.id);
        const initialCopay = existing
          ? existing.copay_amount
          : computeDefaultCopayAmount(childInput, attendanceDays);

        const partsMap = partsByChildId.get(c.id) ?? new Map<string, boolean>();
        const participations: Record<string, boolean> = {};
        const attendedByEvent: Record<string, boolean> = {};
        /* 保存済みの月に後からイベントを足すと participations 行が存在しない。
           旧実装は `?? false` だったため、出席していても永久に OFF のままだった
           （2026-08-08 の実 DB 調査で 52 件検出）。行の「有無」で分岐する。
           保存済みの明示値は false も含めて職員の判断なので、ここでは書き換えない。 */
        let filledFromAttendance = false;
        for (const ev of evs) {
          const attended = attendedSet.has(attendedKey(c.id, ev.date));
          attendedByEvent[ev.id] = attended;
          if (existing && partsMap.has(ev.id)) {
            participations[ev.id] = partsMap.get(ev.id)!;
          } else {
            /* 未保存の月、または保存後に追加されたイベント → 出席実績から初期値 */
            participations[ev.id] = attended;
            if (existing) filledFromAttendance = true;
          }
        }

        /* 請求項目の値。保存済みがあれば復元（amount_override=null は「自動算出」の意味なので
           そのまま null を保つ。0 と null を取り違えないこと）。 */
        const feeMap = feesByChildId.get(c.id) ?? new Map<string, FeeAmountRow>();
        const feeValues: Record<string, BillingFeeValueInput> = {};
        for (const item of items) {
          const saved = feeMap.get(item.id);
          feeValues[item.id] = {
            checked: saved?.checked ?? false,
            amountOverride: saved?.amount_override ?? null,
            childAmount: childAmountByKey.get(`${c.id}|${item.id}`) ?? null,
          };
        }

        return {
          childId: c.id,
          childName: c.name,
          municipality: c.municipality ?? null,
          child: childInput,
          siblingGroupId: c.sibling_group_id ?? null,
          /* 出席日数は常に利用表 (schedule_entries) のライブカウントを正とする。
             保存値で固定しないので、保存後に利用表を直しても表示/印刷/Excel が追従する
             （per_day 項目・請求額も r.attendanceDays から派生するので自動で追従）。 */
          attendanceDays,
          copayAmount: initialCopay,
          feeValues,
          receivedAt: existing?.received_at ?? null,
          participations,
          attendedByEvent,
          summaryId: existing?.id ?? null,
          /* 新規月、または保存済みでも出席日数が利用表とズレている月は dirty にして
             「保存」で billing_summaries も最新化できるようにする（料金表を読むのはこの画面のみ）。
             出席実績から補完したイベントがある行も dirty にして、保存で永続化できるようにする。 */
          dirty: !existing || existing.attendance_days !== attendanceDays || filledFromAttendance,
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
  }, [rows.length, events.length, feeItems.length]);

  /* 純関数に渡す形（DB 行 → 計算用の最小形）。列の描画順もこの配列に従う */
  const feeItemInputs = useMemo<BillingFeeItemInput[]>(
    () => feeItems.map((i) => ({
      itemId: i.id,
      calcType: i.calc_type,
      unitAmount: i.unit_amount,
      stepAmount: i.step_amount,
    })),
    [feeItems],
  );
  const feeItemInputById = useMemo(
    () => new Map(feeItemInputs.map((i) => [i.itemId, i])),
    [feeItemInputs],
  );

  /* 列の配置（先方要望 2026-08-08）:
       ... / 利用負担額 / 【常時かかる項目】/ 各イベント / 参加費合計 / 【チェック型の項目】/ 請求額 / 兄弟
     チェック型（他施設利用など）は「その月だけ発生する追加費用」なので、
     同じ性質の参加費合計の右に寄せる。常時かかる項目（おやつ等・教材印刷代）は従来どおり左側。
     どちらのグループも display_order 順を保つ。 */
  const mainFeeItems = useMemo(
    () => feeItems.filter((i) => i.calc_type !== 'checkbox'),
    [feeItems],
  );
  const checkboxFeeItems = useMemo(
    () => feeItems.filter((i) => i.calc_type === 'checkbox'),
    [feeItems],
  );

  /* 行の派生値。請求額の式は computeBillingRow が唯一の定義（UI 側で再実装しない）。
     参加費合計 (eventTotal) は別列「参加費合計」として表示すると同時に、請求額にも含める。 */
  const computed = useMemo(() => {
    return rows.map((r) =>
      computeBillingRow(
        r.child,
        r.attendanceDays,
        feeItemInputs,
        r.feeValues,
        events.map((ev) => ({
          eventId: ev.id,
          date: ev.date,
          name: ev.name,
          price: ev.price,
          participated: !!r.participations[ev.id],
        })),
        r.copayAmount,
      ),
    );
  }, [rows, events, feeItemInputs]);
  const computedById = useMemo(
    () => new Map(computed.map((c) => [c.childId, c])),
    [computed],
  );
  /* 請求項目の額を (childId, itemId) で引けるようにする（セル描画用） */
  const feeAmountByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of computed) {
      for (const f of c.feeBreakdown) m.set(`${c.childId}|${f.itemId}`, f.amount);
    }
    return m;
  }, [computed]);

  /* 兄弟グループの児童を隣接させる。グループはその「最初のメンバーが現れる位置」に寄せ、
     グループ未所属の児童の順序は一切変えない（既存の display_order を尊重する安定並べ替え）。 */
  const orderedRows = useMemo(() => {
    const emitted = new Set<string>();
    const out: RowState[] = [];
    for (const r of rows) {
      if (emitted.has(r.childId)) continue;
      if (r.siblingGroupId) {
        for (const s of rows) {
          if (s.siblingGroupId === r.siblingGroupId && !emitted.has(s.childId)) {
            out.push(s);
            emitted.add(s.childId);
          }
        }
      } else {
        out.push(r);
        emitted.add(r.childId);
      }
    }
    return out;
  }, [rows]);

  const siblingLabelById = useMemo(
    () => new Map(siblingGroups.map((g) => [g.id, g.label])),
    [siblingGroups],
  );
  /* 兄弟ごとの請求額小計。表示専用で、全体合計には足さない（足すと二重計上） */
  const siblingSubtotals = useMemo(
    () => computeSiblingSubtotals(
      rows.map((r) => ({
        siblingGroupId: r.siblingGroupId,
        totalAmount: computedById.get(r.childId)?.totalAmount ?? 0,
      })),
    ),
    [rows, computedById],
  );
  /* グループの最終行（そこに小計行を挿し込む）と、グループ内の人数 */
  const lastRowIdxOfGroup = useMemo(() => {
    const m = new Map<string, number>();
    orderedRows.forEach((r, i) => {
      if (r.siblingGroupId) m.set(r.siblingGroupId, i);
    });
    return m;
  }, [orderedRows]);

  /* 合計（footer）。**児童行のみ**を集計する。兄弟小計行は表示専用なので足さない。 */
  const totals = useMemo(() => {
    let attendanceDays = 0;
    let copay = 0;
    const feeTotals: Record<string, number> = {};
    for (const item of feeItems) feeTotals[item.id] = 0;
    const eventTotals: Record<string, number> = {};
    for (const ev of events) eventTotals[ev.id] = 0;
    let eventGrand = 0;
    let grand = 0;
    for (const r of rows) {
      const c = computedById.get(r.childId);
      if (!c) continue;
      attendanceDays += r.attendanceDays;
      copay += r.copayAmount ?? 0;
      for (const f of c.feeBreakdown) feeTotals[f.itemId] = (feeTotals[f.itemId] ?? 0) + f.amount;
      for (const ev of events) {
        if (r.participations[ev.id]) eventTotals[ev.id] += Math.max(0, Math.floor(ev.price));
      }
      eventGrand += c.eventTotal;
      grand += c.totalAmount;
    }
    return { attendanceDays, copay, feeTotals, eventTotals, eventGrand, grand };
  }, [rows, computedById, events, feeItems]);

  /* イベント参加チェックと利用表の出席実績のズレ。
     保存済みの明示値は「職員が意図的に外した/付けた」可能性があるため自動では直さず
     （実 DB 調査で「出席なし × チェック ON」が 12 件実在）、検出して知らせるだけにする。
     揃えるのは職員が「出席実績に合わせる」を押したときだけ。 */
  const drift = useMemo(() => {
    const cells: Array<{ childId: string; eventId: string; attended: boolean }> = [];
    for (const r of rows) {
      for (const ev of events) {
        const attended = !!r.attendedByEvent[ev.id];
        if (!!r.participations[ev.id] !== attended) {
          cells.push({ childId: r.childId, eventId: ev.id, attended });
        }
      }
    }
    return cells;
  }, [rows, events]);
  const driftKeys = useMemo(
    () => new Set(drift.map((d) => `${d.childId}_${d.eventId}`)),
    [drift],
  );

  /* ズレているセルだけを出席実績に合わせる。ズレていないセルには一切触れない。 */
  const handleAlignToAttendance = () => {
    if (drift.length === 0) return;
    const fixesByChild = new Map<string, Array<{ eventId: string; attended: boolean }>>();
    for (const d of drift) {
      if (!fixesByChild.has(d.childId)) fixesByChild.set(d.childId, []);
      fixesByChild.get(d.childId)!.push({ eventId: d.eventId, attended: d.attended });
    }
    setRows((prev) =>
      prev.map((r) => {
        const fixes = fixesByChild.get(r.childId);
        if (!fixes) return r;
        const participations = { ...r.participations };
        for (const f of fixes) participations[f.eventId] = f.attended;
        return { ...r, participations, dirty: true };
      }),
    );
  };

  const updateRow = (childId: string, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.childId === childId ? { ...r, ...patch, dirty: true } : r)));
  };

  const patchFeeValue = (childId: string, itemId: string, patch: Partial<BillingFeeValueInput>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.childId === childId
          ? {
              ...r,
              feeValues: {
                ...r.feeValues,
                [itemId]: { ...(r.feeValues[itemId] ?? EMPTY_FEE_VALUE), ...patch },
              },
              dirty: true,
            }
          : r,
      ),
    );
  };

  /* 請求項目の ▲▼。表示中の実効額（自動算出 or 調整済み）を起点に ±1 ステップし、override として固定する。
     初回押下時は「自動算出値 ± ステップ」になるので、画面上の数字がそのまま動いて見える。 */
  const handleStepFee = (childId: string, itemId: string, direction: 1 | -1) => {
    const item = feeItemInputById.get(itemId);
    if (!item) return;
    const row = rows.find((r) => r.childId === childId);
    if (!row) return;
    const value = row.feeValues[itemId] ?? EMPTY_FEE_VALUE;
    const current = resolveFeeAmount(item, value, row.attendanceDays);
    patchFeeValue(childId, itemId, { amountOverride: stepFeeAmount(item, current, direction) });
  };

  /* 自動算出に戻す（override を捨てる）。以後は再びマスタ単価・出席日数の変更に追従する。 */
  const handleResetFee = (childId: string, itemId: string) => {
    patchFeeValue(childId, itemId, { amountOverride: null });
  };

  const handleToggleFeeCheckbox = (childId: string, itemId: string) => {
    const row = rows.find((r) => r.childId === childId);
    if (!row) return;
    const value = row.feeValues[itemId] ?? EMPTY_FEE_VALUE;
    patchFeeValue(childId, itemId, { checked: !value.checked });
  };

  /* 請求項目セル 1 個分。計算方式ごとに UI を変える。
     「常時かかる項目」と「チェック型」は表の左右に分かれて描画されるため、
     同じ見た目・同じ操作になるようここに一本化する（2 箇所に書くとズレる）。
     調整済みは 色 + ✎ + title の 3 点で示す（色だけで伝えない: CLAUDE.md §9）。 */
  const renderFeeCell = (r: RowState, item: BillingFeeItemRow) => {
    const itemInput = feeItemInputById.get(item.id);
    const value = r.feeValues[item.id] ?? EMPTY_FEE_VALUE;
    const fee = feeAmountByKey.get(`${r.childId}|${item.id}`) ?? 0;
    const adjusted = value.amountOverride != null;
    const autoFee = itemInput ? computeDefaultFeeAmount(itemInput, value, r.attendanceDays) : 0;
    const hint = adjusted
      ? `手動調整済み（自動算出は ${fmtYen(autoFee)}）。↺ で自動に戻せます`
      : item.calc_type === 'per_day'
        ? `自動算出（出席 ${r.attendanceDays}日 × ${fmtYen(item.unit_amount)}）`
        : item.calc_type === 'per_child_monthly'
          ? '児童設定で入力した月額'
          : item.calc_type === 'checkbox'
            ? `チェックで ${fmtYen(item.unit_amount)} 加算`
            : `月額固定 ${fmtYen(item.unit_amount)}`;

    return (
      <td key={item.id} className="px-2 py-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {item.calc_type === 'per_child_monthly' ? (
          /* 児童設定が正。ここでは読み取り専用 */
          <div className="text-right" title={hint}>
            {fee > 0 ? fmtYen(fee) : ''}
          </div>
        ) : item.calc_type === 'checkbox' ? (
          <>
            <label className="flex items-center justify-end gap-1 cursor-pointer print-hide" title={hint}>
              <input
                type="checkbox"
                checked={value.checked}
                onChange={() => handleToggleFeeCheckbox(r.childId, item.id)}
                aria-label={`${r.childName} の${item.name}`}
              />
              <span style={{ fontSize: '0.78rem', color: value.checked ? 'var(--ink)' : 'var(--ink-3)' }}>
                {value.checked ? fmtYen(fee) : '—'}
              </span>
            </label>
            <span className="hidden print:inline" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {value.checked ? fmtYen(fee) : ''}
            </span>
          </>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 print-hide">
              <button
                type="button"
                style={feeBtnStyle}
                onClick={() => handleStepFee(r.childId, item.id, -1)}
                aria-label={`${r.childName} の${item.name}を減らす`}
                title={`${fmtYen(item.step_amount ?? item.unit_amount)} 減らす`}
              >
                ▼
              </button>
              <span
                title={hint}
                style={{
                  minWidth: '52px',
                  textAlign: 'right',
                  fontSize: '0.78rem',
                  fontVariantNumeric: 'tabular-nums',
                  color: adjusted ? 'var(--accent)' : 'var(--ink)',
                  fontWeight: adjusted ? 700 : 400,
                }}
              >
                {adjusted && <span aria-hidden="true">✎</span>}
                {fmtYen(fee)}
              </span>
              <button
                type="button"
                style={feeBtnStyle}
                onClick={() => handleStepFee(r.childId, item.id, 1)}
                aria-label={`${r.childName} の${item.name}を増やす`}
                title={`${fmtYen(item.step_amount ?? item.unit_amount)} 増やす`}
              >
                ▲
              </button>
              {/* 調整時のみ ↺。未調整でも幅を確保して行のガタつきを防ぐ */}
              {adjusted ? (
                <button
                  type="button"
                  style={{ ...feeBtnStyle, color: 'var(--accent)' }}
                  onClick={() => handleResetFee(r.childId, item.id)}
                  aria-label={`${r.childName} の${item.name}を自動算出に戻す`}
                  title={`自動算出（${fmtYen(autoFee)}）に戻す`}
                >
                  ↺
                </button>
              ) : (
                <span style={{ width: '24px', flexShrink: 0 }} aria-hidden="true" />
              )}
            </div>
            {/* 印刷: 操作 UI を消して金額のみ。未調整で 0 円の場合は従来どおり空欄 */}
            <span className="hidden print:inline" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {adjusted || fee > 0 ? fmtYen(fee) : ''}
            </span>
          </>
        )}
      </td>
    );
  };

  /* 請求項目の列見出し 1 個分。左右のグループで同じ見た目にするため一本化する。 */
  const renderFeeHeader = (item: BillingFeeItemRow) => (
    <th
      key={item.id}
      className="px-2 py-2 text-center font-semibold"
      style={{ width: isFeeOverridable(item.calc_type) ? '130px' : '90px' }}
      title={
        item.calc_type === 'per_day' ? `出席日数 × ${fmtYen(item.unit_amount)}（▲▼ で調整可）`
        : item.calc_type === 'monthly_fixed' ? `月額 ${fmtYen(item.unit_amount)}（▲▼ で調整可）`
        : item.calc_type === 'checkbox' ? `チェックで ${fmtYen(item.unit_amount)} 加算`
        : '児童設定で入力した月額'
      }
    >
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
      {item.calc_type === 'per_day' && (
        <div style={{ fontSize: '0.65rem', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {fmtYen(item.unit_amount)}/日
        </div>
      )}
      {item.calc_type === 'checkbox' && (
        <div style={{ fontSize: '0.65rem', color: item.unit_amount > 0 ? 'var(--ink-3)' : 'var(--red)', whiteSpace: 'nowrap' }}>
          {item.unit_amount > 0 ? fmtYen(item.unit_amount) : '⚠ 金額未設定'}
        </div>
      )}
    </th>
  );

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

  /* 174-B: Excel (xlsx) 出力。exceljs を動的 import して初回のみロード。
     列構成は印刷ビューと同じ (# / 市町村 / 氏名 / 兄弟 / 出席日数 / 利用負担額 /
     各請求項目 / 各イベント / 参加費合計 / 請求額)。兄弟小計行と合計行も含める。 */
  const handleDownloadExcel = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = '名古屋ろう国際センター 職員ステーション';
    wb.created = new Date();

    const facilityName = facility?.name ?? '';
    const sheetName = `${year}年${month}月`;
    const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 4, xSplit: 3 }] });

    /* 画面と同じ列順:
       # / 市町村 / 氏名 / 出席日数 / 利用負担額 / 常時項目 / イベント / 参加費合計 / チェック型 / 請求額 / 兄弟 */
    const FIXED_LEFT = 5; // # / 市町村 / 氏名 / 出席日数 / 利用負担額
    const lastCol = FIXED_LEFT + mainFeeItems.length + events.length + 1 + checkboxFeeItems.length + 2;

    /* タイトル行 */
    ws.mergeCells(1, 1, 1, lastCol);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `${facilityName} 利用料金表  ${year}年${month}月`;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(1).height = 22;

    /* 出力日 (右端) */
    const stampCell = ws.getCell(2, lastCol);
    stampCell.value = `出力: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
    stampCell.font = { size: 9, color: { argb: 'FF6B7280' } };
    stampCell.alignment = { horizontal: 'right' };

    /* ヘッダー (row 3) */
    const headerRow = [
      '#', '市町村', '氏名', '出席日数', '利用負担額',
      ...mainFeeItems.map((i) => i.name),
      ...events.map((ev) => `${ev.name} (${format(new Date(ev.date), 'M/d')} ¥${ev.price.toLocaleString('ja-JP')})`),
      '参加費合計',
      ...checkboxFeeItems.map((i) => i.name),
      '請求額', '兄弟',
    ];
    ws.addRow([]);  /* row 2 空 */
    const hRow = ws.addRow(headerRow);
    hRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'medium' }, right: { style: 'thin' },
      };
    });
    ws.getRow(3).height = 32;

    /* 列幅 */
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 18;
    ws.getColumn(4).width = 9;
    ws.getColumn(5).width = 12;
    let col = FIXED_LEFT + 1;
    for (let i = 0; i < mainFeeItems.length; i++) ws.getColumn(col++).width = 12;
    for (let i = 0; i < events.length; i++) ws.getColumn(col++).width = 14;
    ws.getColumn(col++).width = 12;                                          // 参加費合計
    for (let i = 0; i < checkboxFeeItems.length; i++) ws.getColumn(col++).width = 12;
    ws.getColumn(col++).width = 14;                                          // 請求額
    ws.getColumn(col).width = 10;                                            // 兄弟

    /* データ行（兄弟小計行を挟みながら） */
    orderedRows.forEach((r, idx) => {
      const c = computedById.get(r.childId);
      const dataRow = [
        idx + 1,
        r.municipality ?? '',
        r.childName,
        r.attendanceDays,
        r.copayAmount ?? 0,
        ...mainFeeItems.map((i) => feeAmountByKey.get(`${r.childId}|${i.id}`) ?? 0),
        ...events.map((ev) => (r.participations[ev.id] ? Math.max(0, Math.floor(ev.price)) : 0)),
        c?.eventTotal ?? 0,
        ...checkboxFeeItems.map((i) => feeAmountByKey.get(`${r.childId}|${i.id}`) ?? 0),
        c?.totalAmount ?? 0,
        r.siblingGroupId ? (siblingLabelById.get(r.siblingGroupId) ?? '') : '',
      ];
      const row = ws.addRow(dataRow);
      row.eachCell((cell, colNum) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        /* 数値列は 出席日数(4) 〜 請求額(lastCol-1)。兄弟(lastCol) は文字列なので除く */
        if (colNum >= 4 && colNum <= lastCol - 1) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      });

      /* 兄弟グループの最終行の直下に小計行 */
      if (r.siblingGroupId && lastRowIdxOfGroup.get(r.siblingGroupId) === idx) {
        const label = siblingLabelById.get(r.siblingGroupId) ?? '';
        const subRow = ws.addRow([
          '', '', '', '', '',
          ...mainFeeItems.map(() => ''),
          ...events.map(() => ''),
          '',
          ...checkboxFeeItems.map(() => ''),
          siblingSubtotals.get(r.siblingGroupId) ?? 0,
          `${label} きょうだい合計`,
        ]);
        subRow.eachCell((cell, colNum) => {
          cell.font = { bold: true, italic: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF6E3' } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          if (colNum === lastCol - 1) {
            cell.numFmt = '#,##0';
            cell.alignment = { horizontal: 'right' };
          }
        });
      }
    });

    /* 合計行（児童行のみの集計。兄弟小計は含めない） */
    const totalRow = ws.addRow([
      '', '', '合計',
      totals.attendanceDays,
      totals.copay,
      ...mainFeeItems.map((i) => totals.feeTotals[i.id] ?? 0),
      ...events.map((ev) => totals.eventTotals[ev.id] ?? 0),
      totals.eventGrand,
      ...checkboxFeeItems.map((i) => totals.feeTotals[i.id] ?? 0),
      totals.grand,
      '',
    ]);
    totalRow.eachCell((cell, colNum) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      cell.border = { top: { style: 'medium' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      if (colNum >= 4 && colNum <= lastCol - 1) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fileName = `${facilityName || '事業所'}_利用料金表_${year}-${String(month).padStart(2, '0')}.xlsx`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleSave = async () => {
    if (!me || !facilityId) return;
    setSaving(true);
    setError('');
    try {
      /* 互換のため billing_summaries.snack_fee / kumon_fee / snack_fee_override も書き続ける
         （移行前から存在する列。外部から読む処理が将来現れても壊れないようにする）。 */
      const snackItem = feeItems.find((i) => i.system_key === 'snack');
      const materialItem = feeItems.find((i) => i.system_key === 'material');

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
          snack_fee: snackItem ? (feeAmountByKey.get(`${r.childId}|${snackItem.id}`) ?? 0) : 0,
          snack_fee_override: snackItem ? (r.feeValues[snackItem.id]?.amountOverride ?? null) : null,
          kumon_fee: materialItem ? (feeAmountByKey.get(`${r.childId}|${materialItem.id}`) ?? 0) : 0,
          event_total: c?.eventTotal ?? 0,
          total_amount: c?.totalAmount ?? 0,
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

      const childIdToSumId = new Map(((upserted ?? []) as { id: string; child_id: string }[]).map((u) => [u.child_id, u.id]));
      const summaryIds = Array.from(childIdToSumId.values());

      /* 2) billing_event_participations を全置換（このサマリ群のみ）*/
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

      /* 3) billing_summary_fee_amounts は upsert（delete しない）。
         過去に無効化した項目のスナップショットを消さないため、全置換ではなく差分更新にする。 */
      const feeRowsToUpsert: {
        tenant_id: string; facility_id: string; billing_summary_id: string; fee_item_id: string;
        checked: boolean; amount_override: number | null; amount: number;
      }[] = [];
      for (const r of rows) {
        const sid = childIdToSumId.get(r.childId);
        if (!sid) continue;
        for (const item of feeItems) {
          const v = r.feeValues[item.id] ?? EMPTY_FEE_VALUE;
          feeRowsToUpsert.push({
            tenant_id: me.tenant_id,
            facility_id: facilityId,
            billing_summary_id: sid,
            fee_item_id: item.id,
            checked: v.checked,
            amount_override: v.amountOverride,
            amount: feeAmountByKey.get(`${r.childId}|${item.id}`) ?? 0,
          });
        }
      }
      if (feeRowsToUpsert.length > 0) {
        const { error: feeErr } = await supabase
          .from('billing_summary_fee_amounts')
          .upsert(feeRowsToUpsert, { onConflict: 'billing_summary_id,fee_item_id' });
        if (feeErr) throw new Error(feeErr.message);
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
  /* # / 市町村 / 氏名 / 出席日数 / 利用負担額 (5) + 請求項目 + イベント
     + 参加費合計 + 請求額 + 兄弟 (3) */
  const totalCols = 5 + feeItems.length + events.length + 3;

  /* 動的列（請求項目 + イベント）の総数に応じた印刷密度。
     旧実装はイベント数だけで判定していたが、請求項目も列を増やすので合算で見る。 */
  const dynamicCols = feeItems.length + events.length;
  const printDensity =
    dynamicCols <= 6 ? 'lg' :
    dynamicCols <= 9 ? 'md' :
    dynamicCols <= 12 ? 'sm' : 'xs';

  /* ===== render ===== */
  return (
    <div
      className="flex flex-col -m-6 lg:-m-8 p-6 lg:p-8 billing-print-root"
      data-density={printDensity}
    >
      {/* 印刷 CSS + Excel 風グリッド線（縦横全セル枠線） + 列数に応じた密度自動調整 */}
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
            /* 兄弟の小計行: 塗り + 斜体で「集計であって請求対象の行ではない」ことを示す */
            .billing-grid tbody tr.billing-sibling-subtotal td {
              background: var(--gold-pale);
              font-style: italic;
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
              .billing-grid tbody tr.billing-sibling-subtotal .billing-sticky-col {
                background: var(--gold-pale);
              }
              .billing-grid .billing-sticky-col-1 { left: 0; }
              .billing-grid .billing-sticky-col-2 { left: var(--sticky-c2, 40px); }
              .billing-grid .billing-sticky-col-3 {
                left: var(--sticky-c3, 130px);
                box-shadow: 1px 0 0 var(--rule-strong);
              }
            }
            @media print {
              /* ユーザー要望: 常に A4 横で出力。列が増えても A3 にしない */
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
              /* 列増加に応じてフォント・横パディングを段階縮小（A4 横を維持するため）。
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
              /* ズレ警告の塗りは画面だけ。紙は確定値のみ（インライン style を上書きするため important）*/
              .billing-print-root .billing-drift-cell { background: transparent !important; }
              /* 印刷時もグリッド線を維持（black に切替で印刷時くっきり） */
              .billing-grid th, .billing-grid td { border: 0.5pt solid #000 !important; }
              .billing-grid thead th { border-bottom: 1.2pt solid #000 !important; border-top: 1pt solid #000 !important; }
              .billing-grid tbody tr.billing-total-row td { border-top: 1.2pt solid #000 !important; }
              .billing-grid tbody tr.billing-group-divider td { border-top: 1.5pt double #000 !important; }
              .billing-grid tbody tr.billing-sibling-subtotal td { background: #f2f2f2 !important; }
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
          <Button variant="secondary" onClick={handleDownloadExcel} disabled={rows.length === 0}>📊 Excel 出力</Button>
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

      {/* 利用表とのズレ通知。色だけでなくアイコン + 件数テキストでも伝える（CLAUDE.md §9）。
          月切替の途中は events だけ先に差し替わって rows が前月のままの瞬間があるため、
          読み込み中は出さない（誤った件数が一瞬見えるのを防ぐ）。 */}
      {!loading && drift.length > 0 && (
        <div
          className="flex items-center justify-between flex-wrap gap-2 px-4 py-2 rounded mb-2 print-hide"
          style={{ background: 'var(--gold-pale)', color: 'var(--gold)', fontSize: '0.85rem' }}
        >
          <span>
            <span aria-hidden="true">⚠ </span>
            イベント参加チェックが利用表の出席実績と {drift.length} 件ズレています。
            <span style={{ color: 'var(--ink-3)' }}>
              {' '}（意図して外した分は そのままで構いません）
            </span>
          </span>
          <Button variant="secondary" onClick={handleAlignToAttendance}>
            出席実績に合わせる（{drift.length}件）
          </Button>
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
              /* 固定列の実幅合計: 40+90+140(氏名)+70(出席)+110(負担額)+100(参加費計)+110(請求額)+80(兄弟) */
              minWidth: `${740 + feeItems.length * 130 + events.length * 80}px`,
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
                {mainFeeItems.map((item) => renderFeeHeader(item))}
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
                <th
                  className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                  style={{ width: '100px', background: 'var(--bg)' }}
                  title="各イベントの参加(チェック入り)の合計。請求額にも含まれます。"
                >
                  参加費合計
                </th>
                {/* チェック型（他施設利用など）は「その月だけ発生する追加費用」なので参加費合計の右に置く */}
                {checkboxFeeItems.map((item) => renderFeeHeader(item))}
                <th className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ width: '110px' }}>請求額</th>
                <th
                  className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                  style={{ width: '80px' }}
                  title="兄弟グループ。同じグループの児童は隣接表示され、直下に「きょうだい合計」行が出ます"
                >
                  兄弟
                </th>
              </tr>
            </thead>
            <tbody>
              {orderedRows.map((r, idx) => {
                const c = computedById.get(r.childId);
                /* 小学生以下（preschool / nursery_3〜5）と それ以上の境目に二重線 */
                const underElem = (g: string) =>
                  g === 'preschool' || g === 'nursery_3' || g === 'nursery_4' || g === 'nursery_5';
                const prev = idx > 0 ? orderedRows[idx - 1] : null;
                const isGroupBoundary =
                  prev != null && underElem(prev.child.gradeType) !== underElem(r.child.gradeType);
                const siblingLabel = r.siblingGroupId ? (siblingLabelById.get(r.siblingGroupId) ?? '') : '';
                const isLastOfSiblingGroup =
                  r.siblingGroupId != null && lastRowIdxOfGroup.get(r.siblingGroupId) === idx;
                return (
                  /* 児童行 + （最後の兄弟なら）小計行 の 2 行を返すので、key は Fragment 側に付ける */
                  <Fragment key={r.childId}>
                    <tr className={isGroupBoundary ? 'billing-group-divider' : ''}>
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

                      {mainFeeItems.map((item) => renderFeeCell(r, item))}

                      {events.map((ev) => {
                        const participated = !!r.participations[ev.id];
                        /* 利用表とのズレは 背景色 + アイコン + title の 3 点で示す（色だけで伝えない）。
                           紙には出さない（print-hide）ので、印刷結果は確定値のみ。 */
                        const drifted = driftKeys.has(`${r.childId}_${ev.id}`);
                        const attended = !!r.attendedByEvent[ev.id];
                        const driftHint = !drifted
                          ? undefined
                          : attended
                            ? `${r.childName} は ${format(new Date(ev.date), 'M/d')} に利用表で出席実績がありますが、チェックが外れています`
                            : `${r.childName} は ${format(new Date(ev.date), 'M/d')} に利用表で出席実績がありませんが、チェックが入っています`;
                        return (
                          <td
                            key={ev.id}
                            className={`px-2 py-2 text-center${drifted ? ' billing-drift-cell' : ''}`}
                            style={drifted ? { background: 'var(--gold-pale)' } : undefined}
                          >
                            <label className="inline-flex items-center gap-1 cursor-pointer print-hide" title={driftHint}>
                              <input
                                type="checkbox"
                                checked={participated}
                                onChange={() => handleToggleEvent(r.childId, ev.id)}
                              />
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.78rem', color: participated ? 'var(--ink)' : 'var(--ink-3)' }}>
                                {participated ? fmtYen(ev.price) : '—'}
                              </span>
                              {drifted && (
                                <span aria-hidden="true" style={{ color: 'var(--gold)', fontWeight: 700 }}>
                                  {attended ? '⚠' : '＋'}
                                </span>
                              )}
                            </label>
                            {drifted && <span className="sr-only">{driftHint}</span>}
                            <span className="hidden print:inline" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {participated ? fmtYen(ev.price) : ''}
                            </span>
                          </td>
                        );
                      })}
                      {/* 参加費合計 (各イベント参加チェックの合計を集約表示。請求額にも含まれる) */}
                      <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums', background: 'var(--bg)', color: 'var(--ink-3)' }}>
                        {c && c.eventTotal > 0 ? fmtYen(c.eventTotal) : ''}
                      </td>
                      {checkboxFeeItems.map((item) => renderFeeCell(r, item))}
                      <td className="px-2 py-2 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {c ? fmtYen(c.totalAmount) : ''}
                      </td>
                      <td className="px-2 py-2 text-center whitespace-nowrap" style={{ fontSize: '0.78rem', color: 'var(--gold)', fontWeight: siblingLabel ? 700 : 400 }}>
                        {siblingLabel}
                      </td>
                    </tr>

                    {/* きょうだい小計行。表示専用で、下の合計行には含めない（二重計上の防止） */}
                    {isLastOfSiblingGroup && (
                      <tr className="billing-sibling-subtotal">
                        <td className="px-2 py-2 billing-sticky-col billing-sticky-col-1" />
                        <td className="px-2 py-2 billing-sticky-col billing-sticky-col-2" />
                        <td className="px-2 py-2 billing-sticky-col billing-sticky-col-3" />
                        {/* 請求額の直前まで（出席日数〜チェック型項目）を 1 セルにまとめて見出しにする */}
                        <td className="px-2 py-2 text-right" colSpan={totalCols - 5} style={{ fontSize: '0.8rem' }}>
                          <span aria-hidden="true">👨‍👩‍👧 </span>きょうだい合計
                        </td>
                        <td className="px-2 py-2 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtYen(siblingSubtotals.get(r.siblingGroupId!) ?? 0)}
                        </td>
                        <td className="px-2 py-2 text-center whitespace-nowrap" style={{ fontSize: '0.78rem', color: 'var(--gold)', fontWeight: 700 }}>
                          {siblingLabel}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {/* 合計行（児童行のみの集計。きょうだい小計は含めない） */}
              <tr className="billing-total-row" style={{ background: 'var(--bg)', fontWeight: 700 }}>
                <td colSpan={3} className="px-2 py-2 text-right billing-sticky-col billing-sticky-col-1">合計</td>
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{totals.attendanceDays}</td>
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtYen(totals.copay)}</td>
                {mainFeeItems.map((item) => (
                  <td key={item.id} className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtYen(totals.feeTotals[item.id] ?? 0)}
                  </td>
                ))}
                {events.map((ev) => (
                  <td key={ev.id} className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtYen(totals.eventTotals[ev.id] ?? 0)}
                  </td>
                ))}
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums', background: 'var(--bg)', color: 'var(--ink-3)' }}>{fmtYen(totals.eventGrand)}</td>
                {checkboxFeeItems.map((item) => (
                  <td key={item.id} className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtYen(totals.feeTotals[item.id] ?? 0)}
                  </td>
                ))}
                <td className="px-2 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtYen(totals.grand)}</td>
                <td className="px-2 py-2" />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs mt-3 print-hide" style={{ color: 'var(--ink-3)' }}>
        ※ 利用負担額の初期値は児童設定の上限額。デイロボで算出した金額をこの欄に上書きしてください。
        <br />
        ※ 請求項目（おやつ等・教材印刷代・他施設利用 など）は「請求項目設定」で自由に追加・削除できます。
        ▲▼ で調整するとその月は金額が固定され（<span style={{ color: 'var(--accent)', fontWeight: 700 }}>✎</span> 付きで表示）、
        あとから出席日数や単価を直しても追従しなくなります。↺ で自動算出に戻せます。
        <br />
        ※ イベント参加チェックは、その日に利用表で出席実績がある児童に自動で入ります
        （保存後にイベントを追加した場合も同じ）。手動で付け外しした分は保存され、あとから勝手に変わりません。
        利用表とズレている場合は <span style={{ color: 'var(--gold)', fontWeight: 700 }}>⚠</span>（出席あり・チェック無し）/
        <span style={{ color: 'var(--gold)', fontWeight: 700 }}> ＋</span>（出席無し・チェック有り）で示され、
        上部の「出席実績に合わせる」でまとめて揃えられます。
        <br />
        ※ 出席日数 = 利用予定で時間が入っている日のカウント（欠席 / お休み / キャンセル待ちは除外）。
        利用表に時間さえ入れれば自動でカウントされます。
        <br />
        ※ 兄弟グループは児童設定で設定します。同じグループの児童は隣接表示され、直下に「きょうだい合計」行が出ます。
        各児童の行は個別金額のままで、いちばん下の合計は児童行だけを足しています（きょうだい合計は二重に足しません）。
      </p>
    </div>
  );
}
