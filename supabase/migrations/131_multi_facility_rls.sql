-- 131_multi_facility_rls.sql
-- Phase 67-B: 兼任 (employee_facilities) を考慮した RLS 全面更新
--
-- 主な変更点:
--   1. ヘルパー employee_in_my_managed_facilities(emp_id) を追加
--      - 「指定職員が、自分が管轄するいずれかの施設に所属しているか」を返す
--      - manager の cross-facility 可視性 (shift_requests, shift_assignments) で使用
--   2. get_manager_subordinate_ids() を employee_facilities (兼任) も含めるよう拡張
--   3. RLS 大改修:
--      - facility-only テーブル (children / schedule_entries / events / billing /
--        facility_shift_settings) → manager は get_my_managed_facility_ids() で絞る
--      - employee-level cross-facility テーブル (shift_requests / shift_assignments /
--        shift_change_requests) → 兼任職員の行も自施設マネージャーが見られるように
--        employee_in_my_managed_facilities() ベースに置換
--
-- 副次効果: 既存の shift RLS は単一 facility_id 前提で manager_facilities (045) が効いて
-- いなかったが、本 migration で manager_facilities が shift にも有効になる。

-- ============================================================
-- 1. ヘルパー: 指定職員が自分の管轄施設に所属しているか
-- ============================================================

create or replace function employee_in_my_managed_facilities(p_employee_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.employees e
     where e.id = p_employee_id
       and (
         e.facility_id in (select get_my_managed_facility_ids())
         or exists (
           select 1 from public.employee_facilities ef
            where ef.employee_id = e.id
              and ef.facility_id in (select get_my_managed_facility_ids())
         )
       )
  );
$$ language sql security definer stable;

comment on function employee_in_my_managed_facilities(uuid) is
  '指定職員が、自分が管轄する施設のいずれか (primary または兼任先) に所属しているか。manager の cross-facility 可視性で使用。';

-- ============================================================
-- 2. get_manager_subordinate_ids() を兼任対応に
-- ============================================================

create or replace function get_manager_subordinate_ids()
returns setof uuid as $$
  -- 自分の管轄施設 (primary または manager_facilities) に所属する全職員
  -- (employees.facility_id 一致 OR employee_facilities 経由の兼任一致)
  select distinct e.id
  from public.employees e
  where e.tenant_id = (select tenant_id from public.employees where auth_user_id = auth.uid() limit 1)
    and (
      e.facility_id in (select get_my_managed_facility_ids())
      or exists (
        select 1 from public.employee_facilities ef
         where ef.employee_id = e.id
           and ef.facility_id in (select get_my_managed_facility_ids())
      )
    );
$$ language sql security definer stable;

-- ============================================================
-- 3. children RLS: facility-only。get_my_managed_facility_ids() ベースに
-- ============================================================

drop policy if exists children_manager_facility on public.children;
create policy children_manager_facility on public.children for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- ============================================================
-- 4. schedule_entries RLS: facility-only
-- ============================================================

drop policy if exists se_manager_facility on public.schedule_entries;
create policy se_manager_facility on public.schedule_entries for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- ============================================================
-- 5. shift_requests RLS: employee-level cross-facility
--    兼任職員の休み希望は、両方の所属施設マネージャーが見える
-- ============================================================

drop policy if exists sr_manager_facility on public.shift_requests;
create policy sr_manager_facility on public.shift_requests for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and (
      facility_id in (select get_my_managed_facility_ids())
      or employee_in_my_managed_facilities(employee_id)
    )
  );

-- 既存の sr_employee_own は employee 自身のみだが、
-- 兼任職員は提出時に「どの facility に対する希望か」を選べる必要があるため、
-- INSERT 時に facility_id が自分の所属施設集合に含まれるかを WITH CHECK で検証する
drop policy if exists sr_employee_own on public.shift_requests;
create policy sr_employee_own on public.shift_requests for all
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  )
  with check (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
    and facility_id in (select get_my_facility_ids())
  );

-- ============================================================
-- 6. shift_assignments RLS:
--    - 編集: manager 自施設のみ (strict)
--    - SELECT: 兼任職員の他施設 assignment も読める (cross-facility 表示用)
--      → B 施設のシフト表で、兼任職員の「A 勤務」バッジを表示するため
-- ============================================================

drop policy if exists sa_manager_facility on public.shift_assignments;
create policy sa_manager_facility on public.shift_assignments for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- 追加 SELECT-only: cross-facility 表示用
-- manager は自分の管轄施設に所属している職員の他施設 assignment も読める
drop policy if exists sa_manager_cross_facility_select on public.shift_assignments;
create policy sa_manager_cross_facility_select on public.shift_assignments for select
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and employee_in_my_managed_facilities(employee_id)
  );

-- 追加 SELECT-only: employee は自分の他施設 assignment も読める (published のみ)
-- 自分の /my/shifts ページで「他施設での勤務予定」も見られるように
drop policy if exists sa_employee_cross_facility_select on public.shift_assignments;
create policy sa_employee_cross_facility_select on public.shift_assignments for select
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and publish_status = 'published'
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  );

-- ============================================================
-- 7. transport_assignments RLS: facility-only (manager_facilities ベース)
--    既に migration 112 で manager_facilities UNION パターンになっているが、
--    新ヘルパーで書き直して一貫性を保つ
-- ============================================================

drop policy if exists ta_admin_mgr_all on public.transport_assignments;
drop policy if exists ta_admin_all on public.transport_assignments;
drop policy if exists ta_manager_facility on public.transport_assignments;

create policy ta_admin_all on public.transport_assignments for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

create policy ta_manager_facility on public.transport_assignments for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  )
  with check (
    tenant_id = get_my_tenant_id()
  );

-- ============================================================
-- 8. shift_change_requests RLS: employee-level cross-facility
-- ============================================================

drop policy if exists scr_select on public.shift_change_requests;
drop policy if exists scr_insert on public.shift_change_requests;
drop policy if exists scr_update on public.shift_change_requests;
drop policy if exists scr_delete on public.shift_change_requests;

-- SELECT: 自分のもの + admin 全件 + manager 管轄職員の全件
create policy scr_select on public.shift_change_requests for select
  using (
    tenant_id = get_my_tenant_id()
    and (
      get_my_role() = 'admin'
      or (
        get_my_role() = 'manager'
        and (
          facility_id in (select get_my_managed_facility_ids())
          or employee_in_my_managed_facilities(employee_id)
        )
      )
      or employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
    )
  );

-- INSERT: 自分の申請 / admin / manager (管轄職員のみ)
create policy scr_insert on public.shift_change_requests for insert with check (
  tenant_id = get_my_tenant_id()
  and (
    get_my_role() = 'admin'
    or (
      get_my_role() = 'manager'
      and employee_in_my_managed_facilities(employee_id)
    )
    or employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  )
);

-- UPDATE: admin / 自分(pending のみ) / manager (管轄職員)
create policy scr_update on public.shift_change_requests for update
  using (
    tenant_id = get_my_tenant_id()
    and (
      get_my_role() = 'admin'
      or (
        get_my_role() = 'manager'
        and employee_in_my_managed_facilities(employee_id)
      )
      or (
        employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
        and status = 'pending'
      )
    )
  ) with check (tenant_id = get_my_tenant_id());

-- DELETE: admin のみ
create policy scr_delete on public.shift_change_requests for delete
  using (tenant_id = get_my_tenant_id() and get_my_role() = 'admin');

-- ============================================================
-- 9. facility_shift_settings RLS: facility-only
-- ============================================================

drop policy if exists fss_manager_own on public.facility_shift_settings;
create policy fss_manager_own on public.facility_shift_settings for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- ============================================================
-- 10. events RLS: facility-only
-- ============================================================

drop policy if exists ev_manager_facility on public.events;
create policy ev_manager_facility on public.events for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- ============================================================
-- 11. billing_summaries RLS: facility-only
-- ============================================================

drop policy if exists bs_manager_facility on public.billing_summaries;
create policy bs_manager_facility on public.billing_summaries for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- ============================================================
-- 12. billing_event_participations RLS: facility-only (親 billing_summaries 経由)
-- ============================================================

drop policy if exists bep_manager_facility on public.billing_event_participations;
create policy bep_manager_facility on public.billing_event_participations for all
  using (
    get_my_role() = 'manager'
    and exists (
      select 1 from public.billing_summaries bs
      where bs.id = billing_event_participations.billing_summary_id
        and bs.tenant_id = get_my_tenant_id()
        and bs.facility_id in (select get_my_managed_facility_ids())
    )
  );
