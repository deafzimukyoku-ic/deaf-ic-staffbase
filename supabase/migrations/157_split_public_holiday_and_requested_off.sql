-- 157: 公休 / 希望休 の分離 + shift_requests.request_type CHECK の修正
--
-- 背景:
-- これまで「公休」は社員の休み希望 (shift_requests) にも確定シフト (shift_assignments) にも
-- 同じ public_holiday 値で存在し、「管理者が決めた休み」と「社員が希望した休み」が
-- 区別できなかった。要件に合わせて分離する:
--   - 公休 (public_holiday)   = 管理者がシフト作成画面で直接マークした休み
--   - 希望休 (requested_off)  = 社員が休み希望として出した休み (shift_requests 由来)
--
-- さらに shift_requests.request_type の旧 CHECK は
--   ('public_holiday','paid_leave','available_day')
-- の 3 値で、アプリ (MyRequestsView) が実際に insert する
--   full_day_available / am_off / pm_off
-- を許可しておらず、それらの休み希望保存は CHECK 制約違反で失敗していた（既存バグ）。
-- 旧 available_day は本番に 0 行・アプリ未使用のため廃止し、CHECK を実使用値に作り直す。
--
-- データ実態 (適用前):
--   shift_requests:    public_holiday x8, paid_leave x3   (available_day / am_off 等は 0 行)
--   shift_assignments: normal x172, off x238, public_holiday x16, paid_leave x1
--
-- shift_assignments の既存 public_holiday 16 行は、旧フローでは generateShift が
-- 社員の休み希望 (request_type='public_holiday') からのみ生成していたため、
-- すべて「社員の希望由来」とみなし requested_off (希望休) へ移行する。
-- 今後 public_holiday (公休) は管理者がシフト作成画面で明示的にマークしたものだけになる。

begin;

-- ===== shift_requests: public_holiday -> requested_off にリネーム + CHECK 作り直し =====
alter table public.shift_requests
  drop constraint if exists shift_requests_request_type_check;

update public.shift_requests
  set request_type = 'requested_off'
  where request_type = 'public_holiday';

alter table public.shift_requests
  add constraint shift_requests_request_type_check
  check (request_type in ('requested_off', 'paid_leave', 'full_day_available', 'am_off', 'pm_off'));

-- ===== shift_assignments: requested_off (希望休) を追加 + 既存 public_holiday を移行 =====
alter table public.shift_assignments
  drop constraint if exists shift_assignments_assignment_type_check;

update public.shift_assignments
  set assignment_type = 'requested_off'
  where assignment_type = 'public_holiday';

alter table public.shift_assignments
  add constraint shift_assignments_assignment_type_check
  check (assignment_type in ('normal', 'public_holiday', 'requested_off', 'paid_leave', 'off'));

commit;
