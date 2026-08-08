/**
 * 利用料金表（月次）の計算ロジック（Phase 66-C → migration 222 で請求項目を可変化）
 *
 * 純関数のみ。DB アクセスはしない。引数で必要な情報を全部受け取る。
 *
 * 計算式:
 *   無償化対象 = grade ∈ {nursery_3, nursery_4, nursery_5}
 *             OR (grade='preschool' AND municipality === '名古屋市')
 *   利用負担額 (デフォルト):
 *     無償化 OR copay_tier='zero' OR 出席日数=0 → null（"—" 表示）
 *     copay_tier='freeform' → cap = copay_freeform_amount ?? 0（0 → null）
 *     copay_tier='4600' / '37200'             → cap = 4600 / 37200
 *     ※ デイロボの精緻計算は料金表ページで「手動オーバーライド」する。この純関数は初期値のみ返す
 *
 *   請求項目（billing_fee_items）… おやつ等 / 教材印刷代 / 他施設利用 などを事業所が自由に設定する。
 *     per_day           = 出席日数 × unit_amount     （旧「おやつ等」= unit 50）
 *     per_child_monthly = 児童ごとの月額             （旧「教材印刷代」= children_fee_amounts）
 *     monthly_fixed     = unit_amount               （事業所共通の月額固定）
 *     checkbox          = checked ? unit_amount : 0 （他施設利用など）
 *     いずれも amount_override が入っていればその額で固定される（＝その月は自動算出に追従しない）
 *
 *   参加費合計 = Σ(参加した event の price)  ※ 料金表 UI では別列表示するが、請求額には含める
 *   請求額     = (利用負担額 ?? 0) + Σ請求項目 + 参加費合計
 */

import {
  COPAY_TIER_AMOUNT,
  FREE_GRADES_NATIONWIDE,
  NAGOYA_FREE_PRESCHOOL_MUNICIPALITY,
  type CopayTierConst,
  type GradeType,
} from '@/lib/constants';
import type { CopayTier, FeeCalcType } from '@/lib/types';

export interface BillingChildInput {
  childId: string;
  gradeType: GradeType;
  municipality: string | null;
  copayTier: CopayTier;
  copayFreeformAmount: number | null;
}

export interface BillingEventInput {
  eventId: string;
  date: string; // YYYY-MM-DD
  name: string;
  price: number;
  /** その児童が参加したか（true=参加→price 計上 / false=不参加） */
  participated: boolean;
}

/** 請求項目マスタ（billing_fee_items）のうち計算に必要な部分 */
export interface BillingFeeItemInput {
  itemId: string;
  calcType: FeeCalcType;
  /** per_day=単価/日 / monthly_fixed=月額 / checkbox=チェック時の加算額 */
  unitAmount: number;
  /** ▲▼ の 1 ステップ幅。null なら unitAmount を 1 ステップとする */
  stepAmount: number | null;
}

/** その児童 × その月 × その項目 の可変値（billing_summary_fee_amounts + children_fee_amounts） */
export interface BillingFeeValueInput {
  /** calcType='checkbox' のときのみ意味を持つ */
  checked: boolean;
  /** null = 自動算出（出席日数・マスタ単価に追従）/ 値あり = その月は固定 */
  amountOverride: number | null;
  /** calcType='per_child_monthly' のときの児童別月額（children_fee_amounts.amount） */
  childAmount: number | null;
}

export interface BillingChildResult {
  childId: string;
  attendanceDays: number;
  copayAmount: number | null; // null = "—"
  /** 各請求項目の計上額（列描画用。0 の項目も含む） */
  feeBreakdown: Array<{ itemId: string; amount: number }>;
  feeTotal: number;
  eventTotal: number;
  totalAmount: number;
  /** 各イベントごとの個別計上（participated=false は 0） */
  eventBreakdown: Array<{ eventId: string; amount: number }>;
}

/** 値が無いときの安全な既定値。呼び出し側で毎回 null チェックを書かないため */
export const EMPTY_FEE_VALUE: BillingFeeValueInput = {
  checked: false,
  amountOverride: null,
  childAmount: null,
};

/**
 * 無償化対象かどうか。
 * 全国: 年少/年中/年長
 * 名古屋市のみ追加: preschool（未就学・幼稚園以下の年齢未指定）
 */
export function isFreeOfCharge(gradeType: GradeType, municipality: string | null): boolean {
  if ((FREE_GRADES_NATIONWIDE as readonly GradeType[]).includes(gradeType)) return true;
  if (gradeType === 'preschool' && (municipality ?? '').trim() === NAGOYA_FREE_PRESCHOOL_MUNICIPALITY) {
    return true;
  }
  return false;
}

/** 児童の上限額（円）を返す。null は「上限が定まらない（=未設定 freeform）」を意味する */
export function resolveCopayCap(child: Pick<BillingChildInput, 'copayTier' | 'copayFreeformAmount'>): number | null {
  if (child.copayTier === 'freeform') {
    if (child.copayFreeformAmount == null || child.copayFreeformAmount <= 0) return null;
    return Math.floor(child.copayFreeformAmount);
  }
  return COPAY_TIER_AMOUNT[child.copayTier as Exclude<CopayTierConst, 'freeform'>];
}

/**
 * 利用負担額の初期値（料金表ページで手動オーバーライド可能）。
 * null は「—」表示。
 */
export function computeDefaultCopayAmount(child: BillingChildInput, attendanceDays: number): number | null {
  if (isFreeOfCharge(child.gradeType, child.municipality)) return null;
  const cap = resolveCopayCap(child);
  if (cap == null || cap <= 0) return null;
  if (attendanceDays === 0) return null;
  return cap;
}

/**
 * 請求項目の自動算出額（円）。amount_override を無視した「本来の額」。
 * 「↺ 自動に戻すと いくらになるか」の表示や、調整済みかどうかの説明に使う。
 */
export function computeDefaultFeeAmount(
  item: BillingFeeItemInput,
  value: BillingFeeValueInput,
  attendanceDays: number,
): number {
  const unit = Math.max(0, Math.floor(item.unitAmount));
  switch (item.calcType) {
    case 'per_day':
      return Math.max(0, attendanceDays) * unit;
    case 'per_child_monthly':
      return value.childAmount != null && value.childAmount > 0 ? Math.floor(value.childAmount) : 0;
    case 'monthly_fixed':
      return unit;
    case 'checkbox':
      return value.checked ? unit : 0;
    default:
      return 0;
  }
}

/**
 * 請求項目の実効額（円）。表示・印刷・Excel・保存はすべてこの関数を通す
 * （UI 側で式を再実装しない。旧実装ではおやつ代の式が 2 箇所に重複していた）。
 *
 * amountOverride が null/undefined なら自動算出（＝出席日数やマスタ単価の変更に追従する）。
 * 値があればそれで固定する。**0（手動で 0 円に固定）と null（自動）は意味が異なる**ため、
 * `||` ではなく `== null` で判定する。`0 || x` の取り違えが本機能の最有力バグ点。
 *
 * checkbox 型は「チェックが入っているときだけ」override を適用する。
 * OFF なのに override が残って課金される事故を防ぐため、OFF は常に 0。
 */
export function resolveFeeAmount(
  item: BillingFeeItemInput,
  value: BillingFeeValueInput,
  attendanceDays: number,
): number {
  if (item.calcType === 'checkbox' && !value.checked) return 0;
  if (value.amountOverride == null) return computeDefaultFeeAmount(item, value, attendanceDays);
  return Math.max(0, Math.floor(value.amountOverride));
}

/** その項目を料金表セルで手動調整できるか（per_child_monthly は児童設定側が正なので不可） */
export function isFeeOverridable(calcType: FeeCalcType): boolean {
  return calcType !== 'per_child_monthly';
}

/**
 * ▲▼ の 1 ステップ後の額（円）。1 ステップ = stepAmount ?? unitAmount。
 * どちらも 0 のときは 50 円（おやつ 1 日分と同じ刻み）を既定とする。
 * 下限 0（マイナスの請求は存在しないため）。
 */
export function stepFeeAmount(
  item: BillingFeeItemInput,
  currentAmount: number,
  direction: 1 | -1,
): number {
  const step = item.stepAmount ?? item.unitAmount;
  const effectiveStep = step > 0 ? Math.floor(step) : 50;
  return Math.max(0, currentAmount + direction * effectiveStep);
}

/**
 * 1 児童分の請求書 1 行を計算する。請求額の式はここが唯一の定義。
 *
 * @param feeValues itemId → その児童のその月の値。無い項目は EMPTY_FEE_VALUE 扱い
 * @param copayOverride 渡すと利用負担額を強制上書きする（料金表ページで手動入力された値）
 */
export function computeBillingRow(
  child: BillingChildInput,
  attendanceDays: number,
  feeItems: BillingFeeItemInput[],
  feeValues: Record<string, BillingFeeValueInput>,
  events: BillingEventInput[],
  copayOverride?: number | null,
): BillingChildResult {
  const copayAmount =
    copayOverride === undefined
      ? computeDefaultCopayAmount(child, attendanceDays)
      : copayOverride;

  const feeBreakdown = feeItems.map((item) => ({
    itemId: item.itemId,
    amount: resolveFeeAmount(item, feeValues[item.itemId] ?? EMPTY_FEE_VALUE, attendanceDays),
  }));
  const feeTotal = feeBreakdown.reduce((s, f) => s + f.amount, 0);

  const eventBreakdown = events.map((e) => ({
    eventId: e.eventId,
    amount: e.participated ? Math.max(0, Math.floor(e.price)) : 0,
  }));
  const eventTotal = eventBreakdown.reduce((s, e) => s + e.amount, 0);

  const totalAmount = (copayAmount ?? 0) + feeTotal + eventTotal;

  return {
    childId: child.childId,
    attendanceDays,
    copayAmount,
    feeBreakdown,
    feeTotal,
    eventTotal,
    totalAmount,
    eventBreakdown,
  };
}

/**
 * 兄弟グループごとの請求額小計（③）。
 * **各児童の行は個別金額のまま**で、グループの直下に小計行を出すためだけに使う。
 * 全体合計に小計行を足すと二重計上になるので、呼び出し側は児童行のみを合計すること。
 */
export function computeSiblingSubtotals(
  rows: Array<{ siblingGroupId: string | null; totalAmount: number }>,
): Map<string, number> {
  const subtotals = new Map<string, number>();
  for (const r of rows) {
    if (!r.siblingGroupId) continue;
    subtotals.set(r.siblingGroupId, (subtotals.get(r.siblingGroupId) ?? 0) + r.totalAmount);
  }
  return subtotals;
}
