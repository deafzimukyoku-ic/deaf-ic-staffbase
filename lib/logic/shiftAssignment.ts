/**
 * シフト割当（shift_assignments）の「出勤系」判定を一元化する純関数。
 *
 * 半休（migration 218 の am_off / pm_off）は勤務時間区間を持つ実出勤である
 * （PM休=午前 [出勤,13:30] / AM休=午後 [14:30,退勤]。generateShift.ts が付与）。
 * しかし送迎表・ホワイトボード・送迎自動割当は長らく assignment_type==='normal' だけを
 * 出勤者として抽出していたため、半休職員がその時間帯に勤務していても「いない」扱いになっていた。
 *
 * この判定を各所に直書きすると、半休のような新区分が増えるたびに追従漏れが起きる
 * （実際 normal 直書きが 4 箇所に散在していた）。lib/logic/attendance.ts の isAttended と同様、
 * 「出勤とみなすか」の唯一の定義をここに置き、抽出は全てここを通す。
 */

import type { ShiftAssignmentRow, ShiftAssignmentType } from '@/lib/types';

/** 出勤系（在席として数える）割当タイプ。normal と半休 am_off / pm_off。 */
const WORKING_ASSIGNMENT_TYPES: ReadonlySet<ShiftAssignmentType> = new Set([
  'normal',
  'am_off',
  'pm_off',
]);

/**
 * その割当タイプが「出勤系」か（＝在席として数えるか）。
 * public_holiday / requested_off / paid_leave / off は false。
 */
export function isWorkingAssignmentType(type: ShiftAssignmentType): boolean {
  return WORKING_ASSIGNMENT_TYPES.has(type);
}

/**
 * その割当が「出勤している勤務セグメント」か。
 * 出勤系タイプ かつ 勤務時間（start_time / end_time）が両方入っている割当だけを true にする。
 * ホワイトボードの出勤者抽出・送迎自動割当の候補判定はこれを通す（時間必須の文脈）。
 */
export function isWorkingShift(
  sa: Pick<ShiftAssignmentRow, 'assignment_type' | 'start_time' | 'end_time'>,
): boolean {
  return isWorkingAssignmentType(sa.assignment_type) && !!sa.start_time && !!sa.end_time;
}
