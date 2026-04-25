-- 115_remove_departments_and_position_role.sql
--
-- A. 部署系（departments / employee_departments / manager_departments / employees.department）を完全削除。
--    4 施設規模の NPO では「施設単位」での管理粒度で十分で、部署は使われていないため。
--
-- B. 役職 (positions) からシステムロール連動を切断。
--    migration 039 で追加された positions.system_role カラム + 同期トリガー
--    (trigger_sync_position_role / trigger_employee_position_role_sync) は
--    「役職を変えたら勝手にシステムロールが書き換わる」という驚き挙動を生むため削除。
--    今後は positions は純粋なラベル、employees.role は独立管理（access-matrix で）。
--
-- 影響:
--   - announcements / compliance_documents / trainings / manuals の target_department_ids カラムを drop
--   - 上記 RLS ポリシーから manager_departments 参照を除去
--   - get_manager_subordinate_ids() 関数から dept 経由の管轄判定を除去
--   - employee_progress ビューには元々 dept 参照無いので変更なし
--   - positions.system_role 削除に伴い、role 同期トリガーを drop

-- ============================================================
-- 1. RLS ポリシーを dept 参照なしで再作成
-- ============================================================

drop policy if exists manager_manage_announcements on announcements;
create policy manager_manage_announcements on announcements
  for all
  using (
    get_my_role() = 'manager' and (
      target_facility_ids && (
        select array_agg(id) from (
          select facility_id as id from employees where auth_user_id = auth.uid() and facility_id is not null
          union
          select facility_id as id from manager_facilities where employee_id = (select id from employees where auth_user_id = auth.uid() limit 1)
        ) as combined_facilities
      )
    )
  );

drop policy if exists manager_manage_compliance on compliance_documents;
create policy manager_manage_compliance on compliance_documents
  for all
  using (
    get_my_role() = 'manager' and (
      target_facility_ids && (
        select array_agg(id) from (
          select facility_id as id from employees where auth_user_id = auth.uid() and facility_id is not null
          union
          select facility_id as id from manager_facilities where employee_id = (select id from employees where auth_user_id = auth.uid() limit 1)
        ) as combined_facilities
      )
    )
  );

drop policy if exists manager_manage_trainings on trainings;
create policy manager_manage_trainings on trainings
  for all
  using (
    get_my_role() = 'manager' and (
      target_facility_ids && (
        select array_agg(id) from (
          select facility_id as id from employees where auth_user_id = auth.uid() and facility_id is not null
          union
          select facility_id as id from manager_facilities where employee_id = (select id from employees where auth_user_id = auth.uid() limit 1)
        ) as combined_facilities
      )
    )
  );

-- ============================================================
-- 2. get_manager_subordinate_ids() を dept 参照なしで再作成
-- ============================================================

create or replace function get_manager_subordinate_ids()
returns setof uuid as $$
  select distinct e.id
  from employees e
  left join manager_facilities mf on mf.facility_id = e.facility_id
  where (
    e.facility_id = (select facility_id from employees where auth_user_id = auth.uid() limit 1)
    or
    mf.employee_id = (select id from employees where auth_user_id = auth.uid() limit 1)
  )
  and e.tenant_id = (select tenant_id from employees where auth_user_id = auth.uid() limit 1);
$$ language sql security definer stable;

-- ============================================================
-- 3. content テーブルから target_department_ids カラム + index を drop
-- ============================================================

drop index if exists idx_announcements_target_department_ids;
drop index if exists idx_compliance_documents_target_department_ids;
drop index if exists idx_trainings_target_department_ids;
drop index if exists idx_manuals_target_department_ids;

alter table announcements        drop column if exists target_department_ids;
alter table compliance_documents drop column if exists target_department_ids;
alter table trainings            drop column if exists target_department_ids;
alter table manuals              drop column if exists target_department_ids;

-- ============================================================
-- 4. dept 関連テーブル / カラムを drop
-- ============================================================

drop table if exists manager_departments cascade;
drop table if exists employee_departments cascade;
drop table if exists departments cascade;

-- 旧 text フィールド（migration 003 由来）
alter table employees drop column if exists department;

-- ============================================================
-- 5. 役職 → システムロール 同期の遮断（migration 039 の取り消し）
-- ============================================================

drop trigger if exists trigger_sync_position_role on positions;
drop trigger if exists trigger_employee_position_role_sync on employees;
drop function if exists sync_employee_role_from_position() cascade;
drop function if exists sync_employee_role_on_update() cascade;

alter table positions drop column if exists system_role;
