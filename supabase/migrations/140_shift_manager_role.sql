-- 140_shift_manager_role.sql
-- Phase 70: 「シフト統括 (shift_manager)」ロール再導入
--
-- 用途:
--   - 事業所共用の操作端末アカウント
--   - マネージャー不在時でも日次出力・業務日報・利用料金表・送迎表・シフト確認が可能
--   - 1 事業所 = 1 アカウント想定（employees.facility_id で固定）
--   - 事業所追加時に admin が UI から自動発行可（Phase 70 で実装）
--
-- アクセス範囲（RLS で許可）:
--   - children / schedule_entries / shift_assignments / transport_assignments /
--     facility_shift_settings / events / billing_summaries / billing_event_participations
--     → manager と同等（自 facility のみ。manager_facilities は使わない）
--   - shift_requests → SELECT only（閲覧のみ、承認・却下不可）
--   - shift_change_requests → manager と同等（運用上必要なため write も可）
--
-- アクセス不可（middleware + UI でブロック）:
--   - announcements / compliance_documents / trainings / manuals
--   - employees の他者編集（自 facility 含む）
--   - tenant 設定 / 事業所追加 / アクセス権限マトリクス

-- ============================================================
-- 1. role CHECK 制約に shift_manager を追加（migration 090 で設定済み制約を更新）
-- ============================================================

alter table public.employees drop constraint if exists employees_role_check;
alter table public.employees
  add constraint employees_role_check
  check (role in ('admin', 'manager', 'employee', 'shift_manager'));

-- ============================================================
-- 2. shift 系テーブルの manager ポリシーに shift_manager を追加
--    既存ポリシーを drop & recreate（manager と同じ条件、role を OR で拡張）
-- ============================================================

drop policy if exists children_manager_facility on public.children;
create policy children_manager_facility on public.children for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

drop policy if exists se_manager_facility on public.schedule_entries;
create policy se_manager_facility on public.schedule_entries for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

drop policy if exists sa_manager_facility on public.shift_assignments;
create policy sa_manager_facility on public.shift_assignments for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

drop policy if exists sa_manager_cross_facility_select on public.shift_assignments;
create policy sa_manager_cross_facility_select on public.shift_assignments for select
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and employee_in_my_managed_facilities(employee_id)
  );

drop policy if exists ta_manager_facility on public.transport_assignments;
create policy ta_manager_facility on public.transport_assignments for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  )
  with check (tenant_id = get_my_tenant_id());

drop policy if exists fss_manager_own on public.facility_shift_settings;
create policy fss_manager_own on public.facility_shift_settings for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

drop policy if exists ev_manager_facility on public.events;
create policy ev_manager_facility on public.events for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

drop policy if exists bs_manager_facility on public.billing_summaries;
create policy bs_manager_facility on public.billing_summaries for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

drop policy if exists bep_manager_facility on public.billing_event_participations;
create policy bep_manager_facility on public.billing_event_participations for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and exists (
      select 1 from public.billing_summaries bs
      where bs.id = billing_event_participations.billing_summary_id
        and bs.tenant_id = get_my_tenant_id()
        and bs.facility_id in (select get_my_managed_facility_ids())
    )
  );

-- ============================================================
-- 3. shift_requests: shift_manager は SELECT only
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

drop policy if exists sr_shift_manager_select on public.shift_requests;
create policy sr_shift_manager_select on public.shift_requests for select
  using (
    get_my_role() = 'shift_manager'
    and tenant_id = get_my_tenant_id()
    and (
      facility_id in (select get_my_managed_facility_ids())
      or employee_in_my_managed_facilities(employee_id)
    )
  );

-- ============================================================
-- 4. shift_change_requests: shift_manager も承認可（運用上必要）
-- ============================================================

drop policy if exists scr_select on public.shift_change_requests;
create policy scr_select on public.shift_change_requests for select
  using (
    tenant_id = get_my_tenant_id()
    and (
      get_my_role() = 'admin'
      or (
        get_my_role() in ('manager', 'shift_manager')
        and (
          facility_id in (select get_my_managed_facility_ids())
          or employee_in_my_managed_facilities(employee_id)
        )
      )
      or employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
    )
  );

drop policy if exists scr_insert on public.shift_change_requests;
create policy scr_insert on public.shift_change_requests for insert with check (
  tenant_id = get_my_tenant_id()
  and (
    get_my_role() = 'admin'
    or (
      get_my_role() in ('manager', 'shift_manager')
      and employee_in_my_managed_facilities(employee_id)
    )
    or employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  )
);

drop policy if exists scr_update on public.shift_change_requests;
create policy scr_update on public.shift_change_requests for update
  using (
    tenant_id = get_my_tenant_id()
    and (
      get_my_role() = 'admin'
      or (
        get_my_role() in ('manager', 'shift_manager')
        and employee_in_my_managed_facilities(employee_id)
      )
      or (
        employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
        and status = 'pending'
      )
    )
  ) with check (tenant_id = get_my_tenant_id());
