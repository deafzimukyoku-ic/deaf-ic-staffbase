/* Phase B の検証。**本番と同じ lib/logic/computeBilling.ts をそのまま import して**
 * 実 DB のデータで動かし、以下を確認する。
 *
 *   1. 移行後の請求額が、移行前の計算（出席日数×50 + 教材印刷代）と 1 円も違わない
 *   2. resolveFeeAmount の 4 方式が仕様どおり（override の 0 と null の区別を含む）
 *   3. checkbox が OFF なら override が残っていても 0 円（誤課金しない）
 *   4. 兄弟小計が「グループ内の請求額の和」であり、全体合計を二重計上しない
 *
 * 実行:
 *   node --experimental-strip-types --import ./scripts/_register-alias.mjs scripts/verify-billing-fee-items.ts
 *
 * 読み取りのみ。DB は一切変更しない。 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeBillingRow,
  computeSiblingSubtotals,
  resolveFeeAmount,
  stepFeeAmount,
  EMPTY_FEE_VALUE,
  type BillingFeeItemInput,
  type BillingFeeValueInput,
} from '@/lib/logic/computeBilling';
import type { CopayTier, FeeCalcType } from '@/lib/types';
import type { GradeType } from '@/lib/constants';

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(import.meta.dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
) as Record<string, string>;
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (期待 ${JSON.stringify(expected)})`}`);
};

/* ============ A. 純関数の単体検証 ============ */
console.log('=== A. resolveFeeAmount / stepFeeAmount ===');
const mkItem = (calcType: FeeCalcType, unitAmount: number, stepAmount: number | null = null): BillingFeeItemInput =>
  ({ itemId: 'i', calcType, unitAmount, stepAmount });
const val = (p: Partial<BillingFeeValueInput> = {}): BillingFeeValueInput => ({ ...EMPTY_FEE_VALUE, ...p });

check('per_day 自動: 出席10日 × 50', resolveFeeAmount(mkItem('per_day', 50), val(), 10), 500);
check('per_day 出席0日', resolveFeeAmount(mkItem('per_day', 50), val(), 0), 0);
check('per_day override=350 で固定', resolveFeeAmount(mkItem('per_day', 50), val({ amountOverride: 350 }), 10), 350);
check('per_day override=0（手動0円）は 0 のまま', resolveFeeAmount(mkItem('per_day', 50), val({ amountOverride: 0 }), 10), 0);
check('per_day override=null は自動に戻る', resolveFeeAmount(mkItem('per_day', 50), val({ amountOverride: null }), 10), 500);
check('per_child_monthly 児童金額 2000', resolveFeeAmount(mkItem('per_child_monthly', 0), val({ childAmount: 2000 }), 10), 2000);
check('per_child_monthly 未設定', resolveFeeAmount(mkItem('per_child_monthly', 0), val(), 10), 0);
check('monthly_fixed 1200', resolveFeeAmount(mkItem('monthly_fixed', 1200), val(), 0), 1200);
check('checkbox ON 800', resolveFeeAmount(mkItem('checkbox', 800), val({ checked: true }), 10), 800);
check('checkbox OFF は 0', resolveFeeAmount(mkItem('checkbox', 800), val({ checked: false }), 10), 0);
/* OFF なのに override が残っているケースで誤課金しないこと（最も怖い事故） */
check('checkbox OFF は override が残っていても 0',
  resolveFeeAmount(mkItem('checkbox', 800), val({ checked: false, amountOverride: 5000 }), 10), 0);
check('checkbox ON + override=1500', resolveFeeAmount(mkItem('checkbox', 800), val({ checked: true, amountOverride: 1500 }), 10), 1500);
check('負の override は 0 にクリップ', resolveFeeAmount(mkItem('per_day', 50), val({ amountOverride: -100 }), 10), 0);

check('step: 単価 50 を 1 ステップ (+)', stepFeeAmount(mkItem('per_day', 50), 500, 1), 550);
check('step: 単価 50 を 1 ステップ (−)', stepFeeAmount(mkItem('per_day', 50), 500, -1), 450);
check('step: 下限 0 でクリップ', stepFeeAmount(mkItem('per_day', 50), 0, -1), 0);
check('step: step_amount 優先', stepFeeAmount(mkItem('monthly_fixed', 1200, 100), 1200, 1), 1300);
check('step: 単価0・step未設定なら 50 刻み', stepFeeAmount(mkItem('checkbox', 0), 0, 1), 50);

/* ============ B. 兄弟小計（二重計上の検出） ============ */
console.log('\n=== B. 兄弟小計 ===');
const sibRows = [
  { siblingGroupId: 'g1', totalAmount: 5000 },
  { siblingGroupId: 'g1', totalAmount: 3000 },
  { siblingGroupId: null, totalAmount: 7000 },
  { siblingGroupId: 'g2', totalAmount: 1000 },
];
const subs = computeSiblingSubtotals(sibRows);
check('g1 小計 = 5000+3000', subs.get('g1'), 8000);
check('g2 小計 = 1000', subs.get('g2'), 1000);
check('単独児はグループを持たない', subs.has('null'), false);
const childRowTotal = sibRows.reduce((s, r) => s + r.totalAmount, 0);
const subtotalSum = [...subs.values()].reduce((s, v) => s + v, 0);
check('全体合計は児童行のみ（小計を足すと二重計上）', childRowTotal, 16000);
check('小計の総和は全体合計と一致しない（＝足してはいけない）', childRowTotal + subtotalSum !== childRowTotal, true);

/* ============ C. 実 DB データで移行前後の請求額を突合 ============ */
console.log('\n=== C. 実 DB で移行前後の請求額を突合 ===');
const SNACK_FEE_PER_DAY = 50;
const isAttended = (e: { attendance_status: string; pickup_time: string | null; dropoff_time: string | null }) =>
  e.attendance_status !== 'waitlist' && !!(e.pickup_time || e.dropoff_time);

async function fetchAll<T>(table: string, columns: string, orderCol: string): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; ; p += 1000) {
    const { data, error } = await sb.from(table).select(columns)
      .order(orderCol, { ascending: true }).range(p, p + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type ChildLite = {
  id: string; facility_id: string; grade_type: GradeType; municipality: string | null;
  copay_tier: CopayTier; copay_freeform_amount: number | null; kumon_monthly_fee: number | null;
  sibling_group_id: string | null;
};
type SummaryLite = {
  id: string; facility_id: string; year: number; month: number; child_id: string;
  child_name_snapshot: string | null; copay_amount: number | null;
  snack_fee: number; snack_fee_override: number | null; kumon_fee: number;
};

const children = await fetchAll<ChildLite>('children',
  'id, facility_id, grade_type, municipality, copay_tier, copay_freeform_amount, kumon_monthly_fee, sibling_group_id', 'id');
const summaries = await fetchAll<SummaryLite>('billing_summaries',
  'id, facility_id, year, month, child_id, child_name_snapshot, copay_amount, snack_fee, snack_fee_override, kumon_fee', 'id');
const items = await fetchAll<{ id: string; facility_id: string; name: string; calc_type: FeeCalcType; unit_amount: number; step_amount: number | null; system_key: string | null; is_active: boolean }>(
  'billing_fee_items', 'id, facility_id, name, calc_type, unit_amount, step_amount, system_key, is_active', 'id');
const childAmounts = await fetchAll<{ child_id: string; fee_item_id: string; amount: number }>(
  'children_fee_amounts', 'child_id, fee_item_id, amount', 'id');
const feeAmts = await fetchAll<{ billing_summary_id: string; fee_item_id: string; checked: boolean; amount_override: number | null }>(
  'billing_summary_fee_amounts', 'billing_summary_id, fee_item_id, checked, amount_override', 'id');
const entries = await fetchAll<{ child_id: string; date: string; pickup_time: string | null; dropoff_time: string | null; attendance_status: string }>(
  'schedule_entries', 'child_id, date, pickup_time, dropoff_time, attendance_status', 'child_id');
const parts = await fetchAll<{ billing_summary_id: string; event_id: string; participated: boolean }>(
  'billing_event_participations', 'billing_summary_id, event_id, participated', 'billing_summary_id');
const events = await fetchAll<{ id: string; facility_id: string; date: string; name: string; price: number }>(
  'events', 'id, facility_id, date, name, price', 'id');

const daysByKey = new Map<string, number>();
for (const e of entries) {
  if (!isAttended(e)) continue;
  const k = `${e.child_id}|${Number(e.date.slice(0, 4))}|${Number(e.date.slice(5, 7))}`;
  daysByKey.set(k, (daysByKey.get(k) ?? 0) + 1);
}
const childById = new Map(children.map((c) => [c.id, c]));
const itemsByFac = new Map<string, typeof items>();
for (const i of items) {
  if (!i.is_active) continue;
  if (!itemsByFac.has(i.facility_id)) itemsByFac.set(i.facility_id, []);
  itemsByFac.get(i.facility_id)!.push(i);
}
const childAmountByKey = new Map(childAmounts.map((a) => [`${a.child_id}|${a.fee_item_id}`, a.amount]));
const feeAmtByKey = new Map(feeAmts.map((f) => [`${f.billing_summary_id}|${f.fee_item_id}`, f]));
const partByKey = new Map(parts.map((p) => [`${p.billing_summary_id}|${p.event_id}`, p.participated]));

let compared = 0, mismatched = 0, sumOld = 0, sumNew = 0;
const rowsForSiblings: Array<{ siblingGroupId: string | null; totalAmount: number }> = [];

for (const s of summaries) {
  const child = childById.get(s.child_id);
  if (!child) continue;
  const days = daysByKey.get(`${s.child_id}|${s.year}|${s.month}`) ?? 0;
  const facItems = itemsByFac.get(s.facility_id) ?? [];

  const feeItemInputs: BillingFeeItemInput[] = facItems.map((i) => ({
    itemId: i.id, calcType: i.calc_type, unitAmount: i.unit_amount, stepAmount: i.step_amount,
  }));
  const feeValues: Record<string, BillingFeeValueInput> = {};
  for (const i of facItems) {
    const saved = feeAmtByKey.get(`${s.id}|${i.id}`);
    feeValues[i.id] = {
      checked: saved?.checked ?? false,
      amountOverride: saved?.amount_override ?? null,
      childAmount: childAmountByKey.get(`${s.child_id}|${i.id}`) ?? null,
    };
  }
  const monthEvents = events.filter((ev) =>
    ev.facility_id === s.facility_id &&
    Number(ev.date.slice(0, 4)) === s.year && Number(ev.date.slice(5, 7)) === s.month);

  const result = computeBillingRow(
    {
      childId: child.id,
      gradeType: child.grade_type,
      municipality: child.municipality,
      copayTier: child.copay_tier,
      copayFreeformAmount: child.copay_freeform_amount,
    },
    days,
    feeItemInputs,
    feeValues,
    monthEvents.map((ev) => ({
      eventId: ev.id, date: ev.date, name: ev.name, price: ev.price,
      participated: partByKey.get(`${s.id}|${ev.id}`) ?? false,
    })),
    s.copay_amount,
  );

  /* 移行前の式（旧 BillingFull.tsx）を再現して突合 */
  const oldSnack = s.snack_fee_override == null
    ? Math.max(0, days) * SNACK_FEE_PER_DAY
    : Math.max(0, Math.floor(s.snack_fee_override));
  const oldKumon = child.kumon_monthly_fee != null && child.kumon_monthly_fee > 0
    ? Math.floor(child.kumon_monthly_fee) : 0;
  const oldEventTotal = monthEvents.reduce(
    (sum, ev) => sum + ((partByKey.get(`${s.id}|${ev.id}`) ?? false) ? Math.max(0, Math.floor(ev.price)) : 0), 0);
  const oldTotal = (s.copay_amount ?? 0) + oldSnack + oldKumon + oldEventTotal;

  compared++;
  sumOld += oldTotal;
  sumNew += result.totalAmount;
  if (oldTotal !== result.totalAmount) {
    mismatched++;
    if (mismatched <= 10) {
      console.log(`  ❌ 不一致: ${s.child_name_snapshot} ${s.year}-${s.month} 旧=¥${oldTotal} 新=¥${result.totalAmount}`);
    }
  }
  rowsForSiblings.push({ siblingGroupId: child.sibling_group_id, totalAmount: result.totalAmount });
}

console.log(`  突合 ${compared} 件 / 不一致 ${mismatched} 件`);
console.log(`  請求額合計 旧 ¥${sumOld.toLocaleString('ja-JP')} → 新 ¥${sumNew.toLocaleString('ja-JP')} ${sumOld === sumNew ? '✅ 完全一致' : '❌ 変わってしまう'}`);
if (mismatched > 0 || sumOld !== sumNew) failures++;

const dbSubs = computeSiblingSubtotals(rowsForSiblings);
console.log(`  兄弟グループ: ${dbSubs.size} 組（未設定なら 0 が正常）`);

/* 請求項目マスタの状態 */
console.log('\n=== D. 請求項目マスタ ===');
for (const [fac, list] of itemsByFac) {
  const facName = fac.slice(0, 8);
  console.log(`  施設 ${facName}…: ${list.map((i) => `${i.name}(${i.calc_type}${i.unit_amount ? ` ¥${i.unit_amount}` : ''})`).join(' / ')}`);
}

console.log(`\n${failures === 0 ? '✅ すべて期待どおり' : `❌ ${failures} 件の失敗`}`);
process.exitCode = failures === 0 ? 0 : 1;
