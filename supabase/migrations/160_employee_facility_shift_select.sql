-- 160: employee が同 facility (主所属 + 兼任先) の published shift_assignments を閲覧可能に
--
-- 背景:
-- /my/requests ページに「施設のシフト」タブを追加し、employee が自分の所属 facility の
-- 全社員 published シフトを表で見られるようにする。これまでは:
--   - 107: 自分の ready/published 自分のみ
--   - 131: 自分の他施設 published 自分のみ (兼任で他施設でも働く場合)
-- いずれも「自分の分のみ」だった。
--
-- 新規ポリシー:
--   - get_my_facility_ids() (130 で定義済: 主所属 + 兼任先 employee_facilities) と
--     一致する facility の published shift_assignments を、全社員分 SELECT 可能
--   - publish_status = 'published' のみ。'draft' / 'ready' は引き続き他人分は不可視
--   - tenant_id 一致を必須に
--
-- プライバシー / セキュリティ:
--   - 勤務表は事業所内のオフィスで掲示されている運用と同等
--   - shift_assignments には date / start_time / end_time / assignment_type / note のみ
--     (住所・連絡先・個人情報なし)
--   - 名前は別途 employees JOIN で取得するが、employees の SELECT RLS は既存通り
--     (同テナント active のみ等) を踏襲するため漏れなし
--
-- ロールバック方法: drop policy sa_employee_facility_shifts on public.shift_assignments;

begin;

drop policy if exists sa_employee_facility_shifts on public.shift_assignments;
create policy sa_employee_facility_shifts on public.shift_assignments for select
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and publish_status = 'published'
    and facility_id in (select get_my_facility_ids())
  );

commit;

notify pgrst, 'reload schema';
