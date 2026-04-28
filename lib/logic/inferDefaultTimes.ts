/**
 * 児童の利用時間 初期値推定（Phase 66+）
 *
 * 利用予定モーダルで空セルをクリックしたとき、過去の同じ「日タイプ（平日 / 土日祝）」の
 * pickup_time / dropoff_time の最頻値を初期値として返す。
 *
 * 設計判断:
 * - 児童属性として default_pickup_time_weekday などを持たない（マスタ管理を増やさない）
 * - 過去 entries から自動推定 → 運用負荷ゼロ・データドリブン
 * - 平日 / 土日祝の 2 タイプのみ（曜日別の細分化はしない、データ希薄になるため）
 */

import { isJpHoliday } from '@/lib/date/holidays';

/** 土日祝なら true、平日なら false */
export function isWeekendOrHoliday(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  return isJpHoliday(date);
}

/** 文字列配列から最頻値を返す（同数なら最初に登場した値）。null/空文字は無視。 */
function pickMode(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (!counts.has(v)) order.push(v);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (order.length === 0) return null;
  let best: string = order[0];
  let bestCount = counts.get(best) ?? 0;
  for (const v of order) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export interface ScheduleEntryLite {
  child_id: string;
  date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
}

/**
 * 同児童 × 同日タイプ（平日 or 土日祝）の過去 entries から pickup_time / dropoff_time の最頻値を返す。
 * データが無ければ null（呼び出し側でハードコード fallback、例: 13:00 / 16:00）。
 */
export function inferChildDefaultTimes(
  childId: string,
  targetDate: string,
  allEntries: ScheduleEntryLite[],
): { pickup: string | null; dropoff: string | null } {
  const targetIsWeekend = isWeekendOrHoliday(targetDate);
  const sameType = allEntries.filter(
    (e) => e.child_id === childId && isWeekendOrHoliday(e.date) === targetIsWeekend,
  );
  return {
    pickup: pickMode(sameType.map((e) => e.pickup_time)),
    dropoff: pickMode(sameType.map((e) => e.dropoff_time)),
  };
}
