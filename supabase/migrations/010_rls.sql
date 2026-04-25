-- 010: RLS ポリシー
-- 共通ヘルパー: 現在ユーザーの employee レコードを取得
create or replace function get_my_employee()
returns setof employees as $$
  select * from employees where auth_user_id = auth.uid()
$$ language sql security definer stable;

create or replace function get_my_tenant_id()
returns uuid as $$
  select tenant_id from employees where auth_user_id = auth.uid() limit 1
$$ language sql security definer stable;

create or replace function get_my_role()
returns text as $$
  select role from employees where auth_user_id = auth.uid() limit 1
$$ language sql security definer stable;

-- ============ tenants ============
alter table tenants enable row level security;

create policy "admin can read own tenant"
  on tenants for select
  using (id = get_my_tenant_id());

create policy "admin can update own tenant"
  on tenants for update
  using (id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

create policy "super_admin full access"
  on tenants for all
  using (get_my_role() = 'super_admin');

-- ============ tenant_payroll_banks ============
alter table tenant_payroll_banks enable row level security;

create policy "tenant members can read banks"
  on tenant_payroll_banks for select
  using (tenant_id = get_my_tenant_id());

create policy "admin can manage banks"
  on tenant_payroll_banks for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- ============ employees ============
alter table employees enable row level security;

create policy "employee can read self"
  on employees for select
  using (auth_user_id = auth.uid());

create policy "admin can read tenant employees"
  on employees for select
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

create policy "employee can update self"
  on employees for update
  using (auth_user_id = auth.uid());

create policy "admin can manage tenant employees"
  on employees for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

create policy "super_admin full employee access"
  on employees for all
  using (get_my_role() = 'super_admin');

-- ============ document_templates ============
alter table document_templates enable row level security;

create policy "tenant members can read templates"
  on document_templates for select
  using (
    tenant_id = get_my_tenant_id()
    or (is_sample = true and tenant_id is null) -- グローバルサンプルは全員閲覧可
  );

create policy "admin can manage templates"
  on document_templates for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

create policy "super_admin can manage samples"
  on document_templates for all
  using (get_my_role() = 'super_admin');

-- ============ document_submissions ============
alter table document_submissions enable row level security;

create policy "employee can manage own submissions"
  on document_submissions for all
  using (employee_id in (select id from get_my_employee()));

create policy "admin can read tenant submissions"
  on document_submissions for select
  using (
    employee_id in (
      select id from employees where tenant_id = get_my_tenant_id()
    )
    and get_my_role() in ('admin', 'super_admin')
  );

-- ============ compliance_documents ============
alter table compliance_documents enable row level security;

create policy "tenant members can read compliance"
  on compliance_documents for select
  using (tenant_id = get_my_tenant_id());

create policy "admin can manage compliance"
  on compliance_documents for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- ============ compliance_acknowledgments ============
alter table compliance_acknowledgments enable row level security;

create policy "employee can manage own acks"
  on compliance_acknowledgments for all
  using (employee_id in (select id from get_my_employee()));

create policy "admin can read tenant acks"
  on compliance_acknowledgments for select
  using (
    employee_id in (
      select id from employees where tenant_id = get_my_tenant_id()
    )
    and get_my_role() in ('admin', 'super_admin')
  );

-- ============ trainings ============
alter table trainings enable row level security;

create policy "tenant members can read trainings"
  on trainings for select
  using (tenant_id = get_my_tenant_id());

create policy "admin can manage trainings"
  on trainings for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- ============ training_submissions ============
alter table training_submissions enable row level security;

create policy "employee can manage own training subs"
  on training_submissions for all
  using (employee_id in (select id from get_my_employee()));

create policy "admin can manage tenant training subs"
  on training_submissions for all
  using (
    employee_id in (
      select id from employees where tenant_id = get_my_tenant_id()
    )
    and get_my_role() in ('admin', 'super_admin')
  );

-- ============ announcements ============
alter table announcements enable row level security;

create policy "tenant members can read announcements"
  on announcements for select
  using (tenant_id = get_my_tenant_id());

create policy "admin can manage announcements"
  on announcements for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- ============ announcement_reads ============
alter table announcement_reads enable row level security;

create policy "employee can manage own reads"
  on announcement_reads for all
  using (employee_id in (select id from get_my_employee()));

create policy "admin can read tenant announcement reads"
  on announcement_reads for select
  using (
    employee_id in (
      select id from employees where tenant_id = get_my_tenant_id()
    )
    and get_my_role() in ('admin', 'super_admin')
  );

-- ============ ai_diagnoses ============
alter table ai_diagnoses enable row level security;

create policy "admin can manage ai diagnoses"
  on ai_diagnoses for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- ============ ai_diagnosis_usage ============
alter table ai_diagnosis_usage enable row level security;

create policy "admin can read usage"
  on ai_diagnosis_usage for select
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

create policy "admin can manage usage"
  on ai_diagnosis_usage for all
  using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));
