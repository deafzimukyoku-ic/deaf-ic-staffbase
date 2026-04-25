-- ============================================================
-- staffbase 全マイグレーション (一括実行用)
-- Supabase SQL Editor にコピペして実行してください
-- ============================================================

-- ==================== 001: tenants ====================
create table tenants (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  representative_title text not null,
  representative_name text not null,
  representative_honorific text not null default '様',
  company_philosophy text,
  action_guidelines text,
  core_values text,
  valued_behaviors text,
  avoided_behaviors text,
  ideal_culture text,
  is_internal boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_status text,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tenants_updated_at
  before update on tenants
  for each row execute function update_updated_at();

-- ==================== 002: tenant_payroll_banks ====================
create table tenant_payroll_banks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  bank_name text not null,
  display_order integer not null default 0,
  is_default boolean not null default false
);

create index idx_payroll_banks_tenant on tenant_payroll_banks(tenant_id);

-- ==================== 003: employees ====================
create table employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id),
  employee_number text not null,
  email text not null,
  role text not null default 'employee',
  status text not null default 'active',
  invited_at timestamptz,
  last_name text not null,
  first_name text not null,
  last_name_kana text not null,
  first_name_kana text not null,
  birth_date date not null,
  gender text,
  postal_code text not null,
  address text not null,
  phone text not null,
  department text,
  position text,
  years_of_service integer,
  job_type text,
  work_location text,
  join_date date not null,
  retirement_date date,
  retirement_reason text,
  has_car_commute boolean not null default false,
  is_shuttle_driver boolean not null default false,
  self_introduction text,
  current_duties text,
  past_duties text,
  qualifications text,
  efforts_focused_on text,
  how_others_describe text,
  values_and_motivation text,
  work_style_solo_vs_team text,
  work_style_clear_vs_autonomy text,
  work_style_stable_vs_change text,
  work_style_think_vs_act text,
  multitask_ability text,
  detail_orientation text,
  comm_conclusion_vs_context text,
  comm_consult_timing text,
  comm_feedback_preference text,
  comm_channel_preference text,
  meeting_behavior text,
  relationship_notes text,
  strength_1 text, strength_2 text, strength_3 text,
  weakness_1 text, weakness_2 text, weakness_3 text,
  success_experience text,
  success_reason text,
  struggle_experience text,
  struggle_reason text,
  suited_tasks text,
  burden_tasks text,
  workplace_values text,
  ideal_boss_colleague text,
  disliked_atmosphere text,
  growth_goal text,
  preferred_evaluation text,
  safe_environment text,
  strengths_self_reported text,
  work_style_preference text,
  team_role_preference text,
  easy_to_work_with text,
  hard_to_work_with text,
  team_mindset text,
  pledge_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, employee_number),
  unique(tenant_id, email)
);

create index idx_employees_tenant on employees(tenant_id);
create index idx_employees_auth on employees(auth_user_id);

create trigger employees_updated_at
  before update on employees
  for each row execute function update_updated_at();

-- ==================== 004: documents ====================
create table document_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  name text not null,
  docx_storage_path text not null,
  mapping jsonb not null default '[]',
  visibility_condition text not null default 'all',
  is_sample boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_doc_templates_tenant on document_templates(tenant_id);

create table document_submissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  document_template_id uuid not null references document_templates(id),
  form_data jsonb not null default '{}',
  status text not null default 'draft',
  submitted_at timestamptz,
  generated_docx_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_doc_submissions_employee on document_submissions(employee_id);

create trigger doc_submissions_updated_at
  before update on document_submissions
  for each row execute function update_updated_at();

-- ==================== 005: compliance ====================
create table compliance_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  content text not null,
  admin_comment text,
  updated_at timestamptz not null default now()
);

create index idx_compliance_docs_tenant on compliance_documents(tenant_id);

create table compliance_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  compliance_document_id uuid not null references compliance_documents(id),
  acknowledged_at timestamptz not null default now(),
  unique(employee_id, compliance_document_id)
);

-- ==================== 006: trainings ====================
create table trainings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  pdf_storage_path text,
  youtube_url text,
  created_at timestamptz not null default now()
);

create index idx_trainings_tenant on trainings(tenant_id);

create table training_submissions (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  summary_text text not null,
  result text not null default 'pending',
  admin_comment text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index idx_training_subs_employee on training_submissions(employee_id);
create index idx_training_subs_training on training_submissions(training_id);

-- ==================== 007: announcements ====================
create table announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_announcements_tenant on announcements(tenant_id);

create table announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, employee_id)
);

-- ==================== 008: ai ====================
create table ai_diagnoses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  diagnosis_type text not null,
  target_employee_ids uuid[] not null,
  result_text text not null,
  created_at timestamptz not null default now()
);

create index idx_ai_diagnoses_tenant on ai_diagnoses(tenant_id);

create table ai_diagnosis_usage (
  tenant_id uuid not null references tenants(id) on delete cascade,
  year_month text not null,
  count integer not null default 0,
  primary key (tenant_id, year_month)
);

-- ==================== 009: progress view ====================
create view employee_progress as
  select
    e.id as employee_id,
    e.tenant_id,
    (select count(*) from document_submissions ds
      where ds.employee_id = e.id and ds.status = 'submitted') as docs_submitted,
    (select count(*) from compliance_acknowledgments ca
      where ca.employee_id = e.id) as compliance_done,
    (select count(*) from training_submissions ts
      where ts.employee_id = e.id and ts.result = 'passed') as trainings_passed,
    (select count(*) from announcement_reads ar
      where ar.employee_id = e.id) as announcements_read
  from employees e;

-- ==================== 010: RLS ====================
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

-- tenants
alter table tenants enable row level security;
create policy "admin can read own tenant" on tenants for select using (id = get_my_tenant_id());
create policy "admin can update own tenant" on tenants for update using (id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));
create policy "super_admin full access tenants" on tenants for all using (get_my_role() = 'super_admin');

-- tenant_payroll_banks
alter table tenant_payroll_banks enable row level security;
create policy "tenant members can read banks" on tenant_payroll_banks for select using (tenant_id = get_my_tenant_id());
create policy "admin can manage banks" on tenant_payroll_banks for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- employees
alter table employees enable row level security;
create policy "employee can read self" on employees for select using (auth_user_id = auth.uid());
create policy "admin can read tenant employees" on employees for select using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));
create policy "employee can update self" on employees for update using (auth_user_id = auth.uid());
create policy "admin can manage tenant employees" on employees for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));
create policy "super_admin full employee access" on employees for all using (get_my_role() = 'super_admin');

-- document_templates
alter table document_templates enable row level security;
create policy "tenant members can read templates" on document_templates for select using (tenant_id = get_my_tenant_id() or (is_sample = true and tenant_id is null));
create policy "admin can manage templates" on document_templates for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));
create policy "super_admin can manage samples" on document_templates for all using (get_my_role() = 'super_admin');

-- document_submissions
alter table document_submissions enable row level security;
create policy "employee can manage own submissions" on document_submissions for all using (employee_id in (select id from get_my_employee()));
create policy "admin can read tenant submissions" on document_submissions for select using (employee_id in (select id from employees where tenant_id = get_my_tenant_id()) and get_my_role() in ('admin', 'super_admin'));

-- compliance_documents
alter table compliance_documents enable row level security;
create policy "tenant members can read compliance" on compliance_documents for select using (tenant_id = get_my_tenant_id());
create policy "admin can manage compliance" on compliance_documents for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- compliance_acknowledgments
alter table compliance_acknowledgments enable row level security;
create policy "employee can manage own acks" on compliance_acknowledgments for all using (employee_id in (select id from get_my_employee()));
create policy "admin can read tenant acks" on compliance_acknowledgments for select using (employee_id in (select id from employees where tenant_id = get_my_tenant_id()) and get_my_role() in ('admin', 'super_admin'));

-- trainings
alter table trainings enable row level security;
create policy "tenant members can read trainings" on trainings for select using (tenant_id = get_my_tenant_id());
create policy "admin can manage trainings" on trainings for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- training_submissions
alter table training_submissions enable row level security;
create policy "employee can manage own training subs" on training_submissions for all using (employee_id in (select id from get_my_employee()));
create policy "admin can manage tenant training subs" on training_submissions for all using (employee_id in (select id from employees where tenant_id = get_my_tenant_id()) and get_my_role() in ('admin', 'super_admin'));

-- announcements
alter table announcements enable row level security;
create policy "tenant members can read announcements" on announcements for select using (tenant_id = get_my_tenant_id());
create policy "admin can manage announcements" on announcements for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- announcement_reads
alter table announcement_reads enable row level security;
create policy "employee can manage own reads" on announcement_reads for all using (employee_id in (select id from get_my_employee()));
create policy "admin can read tenant announcement reads" on announcement_reads for select using (employee_id in (select id from employees where tenant_id = get_my_tenant_id()) and get_my_role() in ('admin', 'super_admin'));

-- ai_diagnoses
alter table ai_diagnoses enable row level security;
create policy "admin can manage ai diagnoses" on ai_diagnoses for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));

-- ai_diagnosis_usage
alter table ai_diagnosis_usage enable row level security;
create policy "admin can read usage" on ai_diagnosis_usage for select using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));
create policy "admin can manage usage" on ai_diagnosis_usage for all using (tenant_id = get_my_tenant_id() and get_my_role() in ('admin', 'super_admin'));
