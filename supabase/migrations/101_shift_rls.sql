-- 101_shift_rls.sql
-- Shift-Maker テーブルの RLS ポリシー（facility 単位）

-- ============================================================
-- children
-- ============================================================
alter table public.children enable row level security;

drop policy if exists children_admin_all on public.children;
create policy children_admin_all on public.children for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists children_manager_facility on public.children;
create policy children_manager_facility on public.children for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

drop policy if exists children_employee_read on public.children;
create policy children_employee_read on public.children for select
  using (get_my_role() = 'employee' and tenant_id = get_my_tenant_id());

-- ============================================================
-- schedule_entries
-- ============================================================
alter table public.schedule_entries enable row level security;

drop policy if exists se_admin_all on public.schedule_entries;
create policy se_admin_all on public.schedule_entries for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists se_manager_facility on public.schedule_entries;
create policy se_manager_facility on public.schedule_entries for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

drop policy if exists se_employee_read on public.schedule_entries;
create policy se_employee_read on public.schedule_entries for select
  using (get_my_role() = 'employee' and tenant_id = get_my_tenant_id());

-- ============================================================
-- shift_requests
-- ============================================================
alter table public.shift_requests enable row level security;

drop policy if exists sr_admin_all on public.shift_requests;
create policy sr_admin_all on public.shift_requests for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists sr_manager_facility on public.shift_requests;
create policy sr_manager_facility on public.shift_requests for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

drop policy if exists sr_employee_own on public.shift_requests;
create policy sr_employee_own on public.shift_requests for all
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  );

-- ============================================================
-- shift_assignments（employee は published のみ、自分の分のみ）
-- ============================================================
alter table public.shift_assignments enable row level security;

drop policy if exists sa_admin_all on public.shift_assignments;
create policy sa_admin_all on public.shift_assignments for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists sa_manager_facility on public.shift_assignments;
create policy sa_manager_facility on public.shift_assignments for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

drop policy if exists sa_employee_read_published on public.shift_assignments;
create policy sa_employee_read_published on public.shift_assignments for select
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and publish_status = 'published'
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  );

-- ============================================================
-- transport_assignments（employee は published のみ、自分の分のみ）
-- ============================================================
alter table public.transport_assignments enable row level security;

drop policy if exists ta_admin_all on public.transport_assignments;
create policy ta_admin_all on public.transport_assignments for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists ta_manager_facility on public.transport_assignments;
create policy ta_manager_facility on public.transport_assignments for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

drop policy if exists ta_employee_read_published on public.transport_assignments;
create policy ta_employee_read_published on public.transport_assignments for select
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and publish_status = 'published'
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  );

-- ============================================================
-- shift_change_requests
-- ============================================================
alter table public.shift_change_requests enable row level security;

drop policy if exists scr_select on public.shift_change_requests;
create policy scr_select on public.shift_change_requests for select
  using (tenant_id = get_my_tenant_id());

drop policy if exists scr_insert on public.shift_change_requests;
create policy scr_insert on public.shift_change_requests for insert with check (
  tenant_id = get_my_tenant_id()
  and (
    get_my_role() in ('admin','manager')
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
        employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
        and status = 'pending'
      )
    )
  ) with check (tenant_id = get_my_tenant_id());

drop policy if exists scr_delete on public.shift_change_requests;
create policy scr_delete on public.shift_change_requests for delete
  using (tenant_id = get_my_tenant_id() and get_my_role() = 'admin');

-- ============================================================
-- attendance_audit_logs（書き込みは RPC 経由のみ）
-- ============================================================
alter table public.attendance_audit_logs enable row level security;

drop policy if exists aal_select on public.attendance_audit_logs;
create policy aal_select on public.attendance_audit_logs for select
  using (tenant_id = get_my_tenant_id());

-- ============================================================
-- child_area_eligible_staff
-- ============================================================
alter table public.child_area_eligible_staff enable row level security;

drop policy if exists caes_select on public.child_area_eligible_staff;
create policy caes_select on public.child_area_eligible_staff for select
  using (tenant_id = get_my_tenant_id());

drop policy if exists caes_insert on public.child_area_eligible_staff;
create policy caes_insert on public.child_area_eligible_staff for insert with check (
  tenant_id = get_my_tenant_id() and get_my_role() in ('admin','manager')
);

drop policy if exists caes_delete on public.child_area_eligible_staff;
create policy caes_delete on public.child_area_eligible_staff for delete using (
  tenant_id = get_my_tenant_id() and get_my_role() in ('admin','manager')
);
