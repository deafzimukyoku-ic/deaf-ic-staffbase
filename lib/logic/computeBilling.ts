/**
 * 利用料金表（月次）の計算ロジック（Phase 66-C）
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
 *   ※ デイロボの精緻計算（出席日数 × 単価でクリップ等）は料金表ページで「手動オーバーライド」する
 *      この純関数は「初期値」を返すだけ。手動入力された値があれば呼び出し側で上書きする想定。
 *
 *   おやつ消耗品代 = 出席日数 × SNACK_FEE_PER_DAY
 *   公文代       = kumonMonthlyFee ?? 0（児童ごと、施設ごとに金額違うため）
 *   イベント代   = Σ(参加した event の price)
 *   請求額       = (利用負担額 ?? 0) + おやつ + 公文 + イベント代
 */

import {
  COPAY_TIER_AMOUNT,
  FREE_GRADES_NATIONWIDE,
  NAGOYA_FREE_PRESCHOOL_MUNICIPALITY,
  SNACK_FEE_PER_DAY,
  type CopayTierConst,
  type GradeType,
} from '@/lib/constants';
import type { CopayTier } from '@/lib/types';

export interface BillingChildInput {
  childId: string;
  gradeType: GradeType;
  municipality: string | null;
  copayTier: CopayTier;
  copayFreeformAmount: number | null;
  /** 公文代の月額（円、null=計上しない） */
  kumonMonthlyFee: number | null;
}

export interface BillingEventInput {
  eventId: string;
  date: string; // YYYY-MM-DD
  name: string;
  price: number;
  /** その児童が参加したか（true=参加→price 計上 / false=不参加） */
  participated: boolean;
}

export interface BillingChildResult {
  childId: string;
  attendanceDays: number;
  copayAmount: number | null; // null = "—"
  snackFee: number;
  kumonFee: number;
  eventTotal: number;
  totalAmount: number;
  /** 各イベントごとの個別計上（請求書の列描画用、participated=false は 0） */
  eventBreakdown: Array<{ eventId: string; amount: number }>;
}

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
 * 1 児童分の請求書 1 行を計算する。
 * copayOverride を渡すと利用負担額を強制上書きする（料金表ページで手動入力された値）。
 */
export function computeBillingRow(
  child: BillingChildInput,
  attendanceDays: number,
  events: BillingEventInput[],
  copayOverride?: number | null,
): BillingChildResult {
  const copayAmount =
    copayOverride === undefined
      ? computeDefaultCopayAmount(child, attendanceDays)
      : copayOverride;
  const snackFee = Math.max(0, attendanceDays) * SNACK_FEE_PER_DAY;
  const kumonFee = child.kumonMonthlyFee != null && child.kumonMonthlyFee > 0
    ? Math.floor(child.kumonMonthlyFee)
    : 0;
  const eventBreakdown = events.map((e) => ({
    eventId: e.eventId,
    amount: e.participated ? Math.max(0, Math.floor(e.price)) : 0,
  }));
  const eventTotal = eventBreakdown.reduce((s, e) => s + e.amount, 0);
  const totalAmount = (copayAmount ?? 0) + snackFee + kumonFee + eventTotal;

  return {
    childId: child.childId,
    attendanceDays,
    copayAmount,
    snackFee,
    kumonFee,
    eventTotal,
    totalAmount,
    eventBreakdown,
  };
}
