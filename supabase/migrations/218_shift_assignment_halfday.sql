-- 218: shift_assignments.assignment_type に am_off / pm_off を追加
--
-- 背景 (docs/features/shift-halfday-availability-reflection.md):
--   休み希望(shift_requests)には am_off(AM休)/pm_off(PM休) があるのに、
--   shift_assignments の CHECK制約は normal/public_holiday/requested_off/paid_leave/off の
--   5値のみで半休を表現できず、generateShift が半休を normal(終日)に丸めていた。
--   落合良子さん(本部7月)の 7/13 PM休 が終日出勤表示になっていた真因。
--   shift_requests と対称化し、シフト割当でも AM休/PM休 を保持できるようにする。
--
-- 半休の勤務区間 (確定値・ユーザー 2026-06-17):
--   PM休(pm_off) = 午前勤務 [出勤, 13:30]
--   AM休(am_off) = 午後勤務 [14:30, 退勤]
--   (区間は生成側/カバレッジ側で扱う。本 migration は CHECK制約のみ)

alter table public.shift_assignments
  drop constraint if exists shift_assignments_assignment_type_check;

alter table public.shift_assignments
  add constraint shift_assignments_assignment_type_check
  check (assignment_type = any (array[
    'normal'::text,
    'public_holiday'::text,
    'requested_off'::text,
    'paid_leave'::text,
    'off'::text,
    'am_off'::text,
    'pm_off'::text
  ]));

-- PostgREST スキーマキャッシュ reload (CHECK 変更検知のため)
notify pgrst, 'reload schema';
