/**
 * 出席判定の一元化（Phase 66-E）
 *
 * deaf-ic 仕様:
 *   出席（= 利用日数 / 当日来所人数 / 送迎対象 / シフト必要人数）
 *     = 「pickup_time または dropoff_time が入っている」
 *       かつ「attendance_status が 'waitlist' ではない」
 *
 *   設計上の前提:
 *   - 利用予定で attendance_status を 'absent' / 'leave' に切り替えると pickup_time / dropoff_time は NULL に強制される
 *     ([components/shift/ScheduleFull.tsx] handleSave)
 *   - 'waitlist' は present 昇格時に時刻を引き継ぐため時刻を保持する（出席にはカウントしない）
 *
 *   そのため判定は「時間が入っていれば来所、ただし waitlist は除外」だけで十分。
 *   旧コードでは absent / leave も明示除外していたが、時間 NULL でも除外できるため重複だった。
 *
 *   この関数を単一の真実とし、料金表 / 日次出力 / 送迎表 / シフト生成 / 児童×職員照合などで共通利用する。
 */

export interface AttendanceCheckable {
  pickup_time: string | null;
  dropoff_time: string | null;
  attendance_status: string | null;
}

/** 出席（実際に来所した・する）と判定できるか */
export function isAttended(e: AttendanceCheckable): boolean {
  if (e.attendance_status === 'waitlist') return false;
  return !!(e.pickup_time || e.dropoff_time);
}

/** キャンセル待ちか（送迎表のキャンセル待ちセクション・バッジ用） */
export function isWaitlist(e: Pick<AttendanceCheckable, 'attendance_status'>): boolean {
  return e.attendance_status === 'waitlist';
}
