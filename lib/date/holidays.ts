import * as holiday_jp from '@holiday-jp/holiday_jp';

/**
 * 日本の祝日判定（振替休日含む）。データ提供: @holiday-jp/holiday_jp (MIT)
 * 表示用のみ。シフト生成ロジックは変更しない。
 */

function toDate(yyyyMmDd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isJpHoliday(dateStr: string): boolean {
  const d = toDate(dateStr);
  if (!d) return false;
  return holiday_jp.isHoliday(d);
}

/** 祝日名を返す。祝日でなければ null */
export function jpHolidayName(dateStr: string): string | null {
  const d = toDate(dateStr);
  if (!d) return null;
  const list = holiday_jp.between(d, d);
  return list.length > 0 ? list[0].name : null;
}
