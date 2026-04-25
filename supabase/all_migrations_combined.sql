-- ==================== 001_tenants.sql ====================
-- 001: tenants テーブル
create table tenants (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  representative_title text not null,
  representative_name text not null,
  representative_honorific text not null default '様',
  -- 会社価値観（カルチャーフィット診断用）
  company_philosophy text,
  action_guidelines text,
  core_values text,
  valued_behaviors text,
  avoided_behaviors text,
  ideal_culture text,
  -- システム
  is_internal boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_status text,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at 自動更新トリガー
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

-- ==================== 002_payroll_banks.sql ====================
-- 002: tenant_payroll_banks テーブル
create table tenant_payroll_banks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  bank_name text not null,
  display_order integer not null default 0,
  is_default boolean not null default false
);

create index idx_payroll_banks_tenant on tenant_payroll_banks(tenant_id);

-- ==================== 003_employees.sql ====================
-- 003: employees テーブル
create table employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id),
  employee_number text not null,
  email text not null,
  role text not null default 'employee',
  status text not null default 'active',
  invited_at timestamptz,

  -- 1-1 基本情報
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

  -- 通勤フラグ
  has_car_commute boolean not null default false,
  is_shuttle_driver boolean not null default false,

  -- 1-2 自己紹介・業務経歴
  self_introduction text,
  current_duties text,
  past_duties text,
  qualifications text,
  efforts_focused_on text,
  how_others_describe text,
  values_and_motivation text,

  -- 1-3 働き方の好み
  work_style_solo_vs_team text,
  work_style_clear_vs_autonomy text,
  work_style_stable_vs_change text,
  work_style_think_vs_act text,
  multitask_ability text,
  detail_orientation text,

  -- 1-4 コミュニケーション傾向
  comm_conclusion_vs_context text,
  comm_consult_timing text,
  comm_feedback_preference text,
  comm_channel_preference text,
  meeting_behavior text,
  relationship_notes text,

  -- 1-5 強み・弱み
  strength_1 text,
  strength_2 text,
  strength_3 text,
  weakness_1 text,
  weakness_2 text,
  weakness_3 text,
  success_experience text,
  success_reason text,
  struggle_experience text,
  struggle_reason text,
  suited_tasks text,
  burden_tasks text,

  -- 1-6 価値観・カルチャー
  workplace_values text,
  ideal_boss_colleague text,
  disliked_atmosphere text,
  growth_goal text,
  preferred_evaluation text,
  safe_environment text,
  strengths_self_reported text,
  work_style_preference text,

  -- 1-7 チーム相性
  team_role_preference text,
  easy_to_work_with text,
  hard_to_work_with text,
  team_mindset text,

  -- 誓約
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

-- ==================== 004_documents.sql ====================
-- 004: document_templates + document_submissions
create table document_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade, -- null = グローバルサンプル
  name text not null,
  docx_storage_path text not null,
  -- プレースホルダマッピング (JSONB配列)
  -- [{key, source_type, source_field, label, input_type, options, required}]
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

-- ==================== 005_compliance.sql ====================
-- 005: compliance_documents + compliance_acknowledgments
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

-- ==================== 006_trainings.sql ====================
-- 006: trainings + training_submissions
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

-- ==================== 007_announcements.sql ====================
-- 007: announcements + announcement_reads
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

-- ==================== 008_ai.sql ====================
-- 008: ai_diagnoses + ai_diagnosis_usage
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
  year_month text not null, -- '2026-04' 形式
  count integer not null default 0,
  primary key (tenant_id, year_month)
);

-- ==================== 009_progress_view.sql ====================
-- 009: employee_progress ビュー
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

-- ==================== 010_rls.sql ====================
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

-- ==================== 011_ai_usage_rpc.sql ====================
-- 011: AI使用量カウントアップRPC
create or replace function increment_ai_usage(p_tenant_id uuid, p_year_month text)
returns void as $$
begin
  insert into ai_diagnosis_usage (tenant_id, year_month, count)
  values (p_tenant_id, p_year_month, 1)
  on conflict (tenant_id, year_month)
  do update set count = ai_diagnosis_usage.count + 1;
end;
$$ language plpgsql security definer;

-- ==================== 012_employee_extended_fields.sql ====================
-- 012: マイカー通勤詳細・送迎運転者詳細・緊急連絡先・身元保証人カラム追加
-- 全て nullable（プロフィール段階的入力のため）

-- ===== マイカー通勤関連 (has_car_commute=true 時に使用) =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS car_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS car_plate_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS license_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS license_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_company text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_certificate_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_period_start date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_period_end date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS commute_distance_km numeric;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS commute_route text;

-- ===== 送迎運転者関連 (is_shuttle_driver=true 時に使用) =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS driving_experience text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS accident_history text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS training_attendance text;

-- ===== 緊急連絡先1 =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_relationship text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_mobile text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_postal_code text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_address text;

-- ===== 緊急連絡先2 =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_relationship text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_mobile text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_postal_code text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_address text;

-- ===== 身元保証人 =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_birth_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_postal_code text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_address text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_relationship text;

-- ==================== 013_fix_progress_view_security.sql ====================
-- 013: employee_progress ビューを SECURITY INVOKER に変更
-- Supabase Linter: security_definer_view 対応
-- INVOKER にすることでクエリ実行ユーザーのRLSポリシーが適用される

DROP VIEW IF EXISTS employee_progress;

CREATE VIEW employee_progress
WITH (security_invoker = true)
AS
  SELECT
    e.id AS employee_id,
    e.tenant_id,
    (SELECT count(*) FROM document_submissions ds
      WHERE ds.employee_id = e.id AND ds.status = 'submitted') AS docs_submitted,
    (SELECT count(*) FROM compliance_acknowledgments ca
      WHERE ca.employee_id = e.id) AS compliance_done,
    (SELECT count(*) FROM training_submissions ts
      WHERE ts.employee_id = e.id AND ts.result = 'passed') AS trainings_passed,
    (SELECT count(*) FROM announcement_reads ar
      WHERE ar.employee_id = e.id) AS announcements_read
  FROM employees e;

-- ==================== 014_align_employee_columns_to_docx.sql ====================
-- 014: docxタグに合わせてemployeesカラム追加
-- 注: car_model, insurance_policy_number, insurance_expiry, commute_distance は
--     012 で正しい名前で作成済み。追加分のみ。
-- 適用済み: 2026-04-12

ALTER TABLE employees ADD COLUMN IF NOT EXISTS license_expiry text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS vehicle_inspection_expiry text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS parking_location text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS my_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS previous_employer text;

-- ==================== 015_manager_role.sql ====================
-- 015: マネージャーロール用テーブル
-- マネージャーが担当する部署の中間テーブル
-- adminが「この社員(manager)はこの部署を担当」と複数指定可能

CREATE TABLE manager_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department text NOT NULL,
  UNIQUE(employee_id, department)
);

CREATE INDEX idx_manager_depts_employee ON manager_departments(employee_id);
CREATE INDEX idx_manager_depts_department ON manager_departments(department);

-- マネージャーの担当部署に所属する社員を返すヘルパー関数
CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  SELECT e.id
  FROM employees e
  INNER JOIN manager_departments md
    ON md.department = e.department
  WHERE md.employee_id = (
    SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
  )
  AND e.tenant_id = (
    SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ==================== 016_manager_rls.sql ====================
-- 016: マネージャーロール用 RLS ポリシー

-- ============ manager_departments ============
ALTER TABLE manager_departments ENABLE ROW LEVEL SECURITY;

-- admin/super_admin が管理（作成・編集・削除）
CREATE POLICY "admin can manage manager_departments"
  ON manager_departments FOR ALL
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE tenant_id = get_my_tenant_id()
    )
    AND get_my_role() IN ('admin', 'super_admin')
  );

-- マネージャー本人は自分の担当部署を読取のみ
CREATE POLICY "manager can read own departments"
  ON manager_departments FOR SELECT
  USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

-- ============ employees: マネージャーが部下を閲覧 ============
CREATE POLICY "manager can read subordinates"
  ON employees FOR SELECT
  USING (
    get_my_role() = 'manager'
    AND id IN (SELECT get_manager_subordinate_ids())
  );

-- ============ trainings: マネージャーが作成・編集可能 ============
CREATE POLICY "manager can insert trainings"
  ON trainings FOR INSERT
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );

CREATE POLICY "manager can update trainings"
  ON trainings FOR UPDATE
  USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );

-- ============ training_submissions: マネージャーが部下の提出を管理 ============
CREATE POLICY "manager can manage subordinate training subs"
  ON training_submissions FOR ALL
  USING (
    get_my_role() = 'manager'
    AND employee_id IN (SELECT get_manager_subordinate_ids())
  );

-- ==================== 017_compliance_multi.sql ====================
-- 遵守事項を複数件対応にする
-- titleカラム追加（各遵守事項を区別）
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';

-- 編集時に再確認を要求するためのバージョンカラム
-- updated_atが更新されたらacknowledgmentを無効化する仕組み
ALTER TABLE compliance_acknowledgments
  ADD COLUMN IF NOT EXISTS document_updated_at timestamptz;

-- 既存のUNIQUE制約を削除し、updated_at付きで再作成
-- これにより同じ社員が同じ文書の新バージョンを再確認できる
ALTER TABLE compliance_acknowledgments
  DROP CONSTRAINT IF EXISTS compliance_acknowledgments_employee_id_compliance_document__key;

-- 社員×文書×バージョンでユニーク
ALTER TABLE compliance_acknowledgments
  ADD CONSTRAINT compliance_ack_emp_doc_version_key
  UNIQUE (employee_id, compliance_document_id, document_updated_at);

-- ==================== 018_registration_rls.sql ====================
-- 新規登録時にテナントとemployeeの作成を許可するRLSポリシー
-- 認証済みユーザーであれば誰でもテナントを作成可能（登録フロー用）
CREATE POLICY "authenticated can insert tenant" ON tenants
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 認証済みユーザーが自分自身のemployeeレコードを作成可能（登録フロー用）
CREATE POLICY "authenticated can insert own employee" ON employees
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

-- ==================== 019_facilities.sql ====================
-- 事業所（施設）テーブル
CREATE TABLE facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_facilities_tenant ON facilities(tenant_id);

-- RLS
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage facilities" ON facilities
  FOR ALL USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() IN ('admin', 'super_admin')
  );

CREATE POLICY "employee can read facilities" ON facilities
  FOR SELECT USING (tenant_id = get_my_tenant_id());

-- employeesにfacility_id追加
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL;

-- ==================== 020_pdf_template_extensions.sql ====================
-- 020: document_templates に PDF テンプレート用カラムを追加
-- template_type DEFAULT 'docx' により既存データに影響なし

ALTER TABLE document_templates
  ADD COLUMN pdf_storage_path text,
  ADD COLUMN page_count integer,
  ADD COLUMN template_type text NOT NULL DEFAULT 'docx',
  ADD COLUMN data_mode text NOT NULL DEFAULT 'employee';

-- docx_storage_path を nullable に変更（PDF テンプレートでは不要）
ALTER TABLE document_templates
  ALTER COLUMN docx_storage_path DROP NOT NULL;

-- CHECK制約
ALTER TABLE document_templates
  ADD CONSTRAINT chk_template_type CHECK (template_type IN ('docx', 'pdf')),
  ADD CONSTRAINT chk_data_mode CHECK (data_mode IN ('employee', 'matrix'));

-- ==================== 021_pdf_tags.sql ====================
-- 021: PDF テンプレートのタグ（列）定義
-- DocMerge の tags テーブルに相当

CREATE TABLE pdf_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  column_key varchar(10) NOT NULL,   -- col_A, col_B, ...
  display_name varchar(50) NOT NULL, -- ユーザー表示名
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, column_key),
  UNIQUE (template_id, display_name)
);

CREATE INDEX idx_pdf_tags_template ON pdf_tags(template_id);

-- ==================== 022_pdf_tag_placements.sql ====================
-- 022: PDF テンプレート上のタグ配置座標
-- DocMerge の tag_placements に相当（format_json → font_size のみに簡略化）

CREATE TABLE pdf_tag_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id uuid NOT NULL REFERENCES pdf_tags(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  page_number integer NOT NULL DEFAULT 1,
  x numeric NOT NULL DEFAULT 0,
  y numeric NOT NULL DEFAULT 0,
  font_size integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_tag_placements_template ON pdf_tag_placements(template_id);

CREATE TRIGGER pdf_tag_placements_updated_at
  BEFORE UPDATE ON pdf_tag_placements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==================== 023_matrix_rows.sql ====================
-- 023: マトリクス（スプレッドシート）データ行
-- DocMerge の matrix_rows に相当

CREATE TABLE matrix_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  row_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, row_index)
);

CREATE INDEX idx_matrix_rows_template ON matrix_rows(template_id);

CREATE TRIGGER matrix_rows_updated_at
  BEFORE UPDATE ON matrix_rows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ==================== 024_pdf_rls.sql ====================
-- 024: PDF関連テーブルの RLS ポリシー
-- テナント所有権を document_templates 経由で検証

-- pdf_tags
ALTER TABLE pdf_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdf_tags_tenant_policy ON pdf_tags
  USING (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tags.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tags.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  );

-- pdf_tag_placements
ALTER TABLE pdf_tag_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdf_tag_placements_tenant_policy ON pdf_tag_placements
  USING (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tag_placements.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tag_placements.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  );

-- matrix_rows
ALTER TABLE matrix_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY matrix_rows_tenant_policy ON matrix_rows
  USING (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = matrix_rows.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = matrix_rows.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  );

-- ==================== 025_compliance_created_at.sql ====================
-- 025: compliance_documents に created_at カラムを追加
-- ページ側で order('created_at') を使用しているが、005_compliance.sql に定義漏れ
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- ==================== 026_departments.sql ====================
-- 026: 部署マスターテーブル
CREATE TABLE departments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_departments_tenant ON departments(tenant_id);

-- RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY departments_tenant_policy ON departments
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ==================== 026_pdf_tags_employee_mode.sql ====================
-- 026: pdf_tags.column_key を拡張（employee mode のドット記法対応）
-- 例: "employee.last_name", "tenant.company_name", "fixed.today"
-- 既存の "col_A", "col_B" 等はそのまま動作

ALTER TABLE pdf_tags ALTER COLUMN column_key TYPE varchar(100);

-- ==================== 027_positions.sql ====================
-- 027: 役職マスターテーブル
CREATE TABLE positions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_positions_tenant ON positions(tenant_id);

-- RLS
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY positions_tenant_policy ON positions
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ==================== 028_custom_employee_fields.sql ====================
-- 028: カスタム入力項目マスター
CREATE TABLE custom_employee_fields (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb DEFAULT '[]'::jsonb,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, field_key),
  CONSTRAINT valid_field_type CHECK (field_type IN ('text', 'date', 'number', 'select', 'image'))
);

CREATE INDEX idx_custom_employee_fields_tenant ON custom_employee_fields(tenant_id);

ALTER TABLE custom_employee_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_employee_fields_tenant_policy ON custom_employee_fields
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- ==================== 028_tenants_plan.sql ====================
-- テナントにプランカラムを追加
ALTER TABLE tenants
  ADD COLUMN plan text NOT NULL DEFAULT 'free'
  CONSTRAINT tenants_plan_check CHECK (plan IN ('free', 'standard', 'pro'));

-- ==================== 029_employee_images.sql ====================
-- 029: 社員画像カラム追加
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS license_image_path text,
  ADD COLUMN IF NOT EXISTS commute_route_image_path text;

-- ==================== 030_employee_bank_account.sql ====================
-- 030: 社員個人の振込先口座カラム追加
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_branch_name text,
  ADD COLUMN IF NOT EXISTS bank_account_type text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_holder text;

-- ==================== 031_commute_route_details.sql ====================
-- 031: 通勤手段・区間詳細カラム追加
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS commute_method text,
  ADD COLUMN IF NOT EXISTS commute_time_minutes int,
  ADD COLUMN IF NOT EXISTS route_section1_route text,
  ADD COLUMN IF NOT EXISTS route_section1_transport text,
  ADD COLUMN IF NOT EXISTS route_section1_cost int,
  ADD COLUMN IF NOT EXISTS route_section2_route text,
  ADD COLUMN IF NOT EXISTS route_section2_transport text,
  ADD COLUMN IF NOT EXISTS route_section2_cost int,
  ADD COLUMN IF NOT EXISTS commute_route_detail text;

-- ==================== 032_compliance_cascade.sql ====================
-- 032: compliance_acknowledgments の外部キーに ON DELETE CASCADE を追加
-- 遵守事項を削除すると関連する確認記録も自動削除される
ALTER TABLE compliance_acknowledgments
  DROP CONSTRAINT IF EXISTS compliance_acknowledgments_compliance_document_id_fkey;

ALTER TABLE compliance_acknowledgments
  ADD CONSTRAINT compliance_acknowledgments_compliance_document_id_fkey
  FOREIGN KEY (compliance_document_id)
  REFERENCES compliance_documents(id)
  ON DELETE CASCADE;

-- ==================== 033_compliance_manager_insert.sql ====================
-- 033: マネージャーに遵守事項の追加のみ許可
CREATE POLICY "manager can insert compliance"
  ON compliance_documents
  FOR INSERT
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );

-- ==================== 034_categories.sql ====================
-- 034: カテゴリ機能（遵守事項・研修・お知らせ共通）
-- 本ファイルは既に本番に適用済み。他環境での再適用に備え IF NOT EXISTS ガードを付与。

CREATE TABLE IF NOT EXISTS categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null check (type in ('compliance','training','announcement')),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, type, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant_type ON categories(tenant_id, type);

-- 使用中カテゴリは削除できない（RESTRICT）。テナント側でレコード整理してから削除する前提。
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_compliance_documents_category ON compliance_documents(category_id);
CREATE INDEX IF NOT EXISTS idx_trainings_category ON trainings(category_id);
CREATE INDEX IF NOT EXISTS idx_announcements_category ON announcements(category_id);

-- ==================== 035_categories_rls_color_icon.sql ====================
-- 035: カテゴリに color / icon カラム追加 + RLS ポリシー
-- icon は絵文字1文字を想定（lucide-react バンドル増を避けるためテナント任意入力）
-- color はアプリ側のプリセット10色から選択（HEX文字列を保存）

-- ========== カラム追加 ==========
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6B7280';
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT '📁';

-- ========== RLS ==========
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーがあれば落としてから再作成（再適用安全性）
DROP POLICY IF EXISTS categories_tenant_select ON categories;
DROP POLICY IF EXISTS categories_admin_manage ON categories;
DROP POLICY IF EXISTS categories_manager_manage ON categories;

-- 社員・管理者・マネージャーとも自テナントのみ SELECT 可
CREATE POLICY categories_tenant_select ON categories
  FOR SELECT
  USING (tenant_id = get_my_tenant_id());

-- テナント管理者（admin / super_admin）は自テナントのカテゴリを全操作可
CREATE POLICY categories_admin_manage ON categories
  FOR ALL
  USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() IN ('admin', 'super_admin')
  );

-- マネージャーも自テナントのカテゴリを作成/編集可（研修・お知らせを作れる立場のため）
CREATE POLICY categories_manager_manage ON categories
  FOR ALL
  USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  )
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );

-- ==================== 036_facility_scope.sql ====================
-- 036_facility_scope.sql
-- announcements / compliance_documents / trainings に「対象スコープ」カラム追加
-- target_type='all' (全社員) または 'facility' (特定施設)
-- target_facility_ids は target_type='facility' のとき複数施設ID配列
-- 既存レコードは DEFAULT 'all' で全社員配信扱いにフォールバック
--
-- 冪等化: 手動で一部を既に実行済みでも再実行可能

-- announcements
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_facility_ids UUID[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_target_type_check') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_target_type_check CHECK (target_type IN ('all', 'facility'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_announcements_target_facility_ids
  ON announcements USING GIN (target_facility_ids);

-- compliance_documents
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS target_facility_ids UUID[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_documents_target_type_check') THEN
    ALTER TABLE compliance_documents ADD CONSTRAINT compliance_documents_target_type_check CHECK (target_type IN ('all', 'facility'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_compliance_documents_target_facility_ids
  ON compliance_documents USING GIN (target_facility_ids);

-- trainings
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS target_facility_ids UUID[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trainings_target_type_check') THEN
    ALTER TABLE trainings ADD CONSTRAINT trainings_target_type_check CHECK (target_type IN ('all', 'facility'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_trainings_target_facility_ids
  ON trainings USING GIN (target_facility_ids);

-- ==================== 037_notification_queue.sql ====================
-- 037_notification_queue.sql
-- 遵守事項・研修・お知らせの作成/編集から2時間後に社員へメール送信するためのキュー
-- 編集時はUPDATEでscheduled_atリセット（新規投稿扱い）
-- 削除時はcancelled_atセット

CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('announcement', 'compliance', 'training')),
  content_id UUID NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  -- enqueue時の投稿者。flush時にこの社員は宛先から除外
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cronの対象取得用（未送信・未キャンセル・時刻到達）
CREATE INDEX IF NOT EXISTS idx_notification_queue_ready
  ON notification_queue (scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- 同一コンテンツで未送信キューは常に1つだけ（編集時UPDATEを強制）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notification_queue_active_content
  ON notification_queue (content_type, content_id)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- RLS: adminとmanagerのみ自テナント分を操作可能、社員は不可、cronはservice roleでbypass
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_queue_admin_manager_all ON notification_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.auth_user_id = auth.uid()
        AND employees.tenant_id = notification_queue.tenant_id
        AND employees.role IN ('admin', 'super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.auth_user_id = auth.uid()
        AND employees.tenant_id = notification_queue.tenant_id
        AND employees.role IN ('admin', 'super_admin', 'manager')
    )
  );

-- ==================== 038_organization_linkage.sql ====================
-- 038: 社員と部署・役職の連動強化

-- 1. employees テーブルに position_id を追加
ALTER TABLE employees ADD COLUMN position_id uuid REFERENCES positions(id) ON DELETE SET NULL;
CREATE INDEX idx_employees_position_id ON employees(position_id);

-- 2. 部署（複数選択）用の中間テーブル作成
CREATE TABLE employee_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, department_id)
);

CREATE INDEX idx_employee_depts_employee ON employee_departments(employee_id);
CREATE INDEX idx_employee_depts_department ON employee_departments(department_id);

-- 3. RLS ポリシー
ALTER TABLE employee_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_depts_tenant_policy ON employee_departments
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_id
      AND e.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_id
      AND e.tenant_id = get_my_tenant_id()
    )
  );

-- 4. 既存データの移行 (簡易版: 文字列が一致する場合に紐付け)
-- ※ 実際の移行はデータ量や運用に合わせて調整が必要ですが、ここではベースを構築します。
-- UPDATE employees e SET position_id = p.id FROM positions p WHERE e.position = p.name AND e.tenant_id = p.tenant_id;
-- INSERT INTO employee_departments (employee_id, department_id)
-- SELECT e.id, d.id FROM employees e JOIN departments d ON e.department = d.name WHERE e.tenant_id = d.tenant_id;

-- ==================== 039_position_roles.sql ====================
-- 039: 役職へのシステムロール割当機能

-- 1. positions テーブルに system_role カラムを追加
-- 値の制約として employee, manager, admin を許容 (super_admin は個別管理とするため除外が一般的)
ALTER TABLE positions ADD COLUMN system_role text DEFAULT 'employee' CHECK (system_role IN ('employee', 'manager', 'admin'));

-- 2. 既存の役職に対してデフォルト値を設定（必要に応じて）
UPDATE positions SET system_role = 'employee' WHERE system_role IS NULL;

-- 3. トリガーの作成（オプション: 役職変更時に社員のロールを自動更新したい場合）
-- ユーザーは「ややこしいから統合したい」と言っているので、役職側のロールを正とする仕組みを導入します。

CREATE OR REPLACE FUNCTION sync_employee_role_from_position()
RETURNS TRIGGER AS $$
BEGIN
  -- 社員の役職が変更された場合、または役職自体のロールが変更された場合に同期
  -- ここでは「役職自体のロールが変更された場合に、その役職を持つ全社員に波及させる」処理を記述
  IF (TG_OP = 'UPDATE' AND OLD.system_role <> NEW.system_role) THEN
    UPDATE employees SET role = NEW.system_role WHERE position_id = NEW.id AND role <> 'super_admin';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_sync_position_role
AFTER UPDATE OF system_role ON positions
FOR EACH ROW EXECUTE FUNCTION sync_employee_role_from_position();

-- 社員側のトリガー（position_id が更新された時に role を同期）
CREATE OR REPLACE FUNCTION sync_employee_role_on_update()
RETURNS TRIGGER AS $$
DECLARE
  target_role text;
BEGIN
  IF (NEW.position_id IS NOT NULL) THEN
    SELECT system_role INTO target_role FROM positions WHERE id = NEW.position_id;
    IF (target_role IS NOT NULL AND NEW.role <> 'super_admin') THEN
      NEW.role := target_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_employee_position_role_sync
BEFORE INSERT OR UPDATE OF position_id ON employees
FOR EACH ROW EXECUTE FUNCTION sync_employee_role_on_update();

-- ==================== 040_refactor_manager_departments.sql ====================
-- 040: manager_departments の部署ID移行

-- 1. カラム追加
ALTER TABLE manager_departments ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE CASCADE;

-- 2. 既存データの移行（テキストが一致するものを紐付け）
UPDATE manager_departments md
SET department_id = d.id
FROM departments d
WHERE md.department = d.name AND d.tenant_id = (
  SELECT tenant_id FROM employees WHERE id = md.employee_id
);

-- 3. 制約の追加（移行後に NULL を許容しない場合）
-- ALTER TABLE manager_departments ALTER COLUMN department_id SET NOT NULL;

-- 4. 古いカラムの削除（必要に応じて。一旦安全のため残す場合はコメントアウト）
-- ALTER TABLE manager_departments DROP COLUMN department;

-- 5. RLS や関数で使用されるため、IDベースのユニーク制約を追加
ALTER TABLE manager_departments ADD CONSTRAINT unique_mgr_dept_id UNIQUE (employee_id, department_id);

-- ==================== 041_update_manager_function.sql ====================
-- 041: マネージャー管轄判定関数のアップデート

CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  -- マネージャー自身が担当する部署(manager_departments)のいずれかに
  -- 所属している社員(employee_departments)のIDを返す
  SELECT DISTINCT ed.employee_id
  FROM employee_departments ed
  INNER JOIN manager_departments md ON md.department_id = ed.department_id
  WHERE md.employee_id = (
    SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
  )
  AND EXISTS (
    -- テナントの整合性チェック
    SELECT 1 FROM employees e WHERE e.id = ed.employee_id AND e.tenant_id = (
      SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ==================== 042_content_targeting_ext.sql ====================
-- 042: 配信ターゲットの拡張 (部署・役職)

-- announcements
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_department_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_position_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_announcements_target_department_ids
  ON announcements USING GIN (target_department_ids);
CREATE INDEX IF NOT EXISTS idx_announcements_target_position_ids
  ON announcements USING GIN (target_position_ids);

-- compliance_documents
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS target_department_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_position_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_compliance_documents_target_department_ids
  ON compliance_documents USING GIN (target_department_ids);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_target_position_ids
  ON compliance_documents USING GIN (target_position_ids);

-- trainings
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS target_department_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_position_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_trainings_target_department_ids
  ON trainings USING GIN (target_department_ids);
CREATE INDEX IF NOT EXISTS idx_trainings_target_position_ids
  ON trainings USING GIN (target_position_ids);

-- ==================== 043_manager_access_control.sql ====================
-- 043: マネージャー向けのアクセス制御 (RLS) - 最終標準化版

-- 1. カラム名の揺れを検知して標準化 (Sの有無などを統一)
DO $$
BEGIN
    -- employee_departments の標準化
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_departments' AND column_name = 'departments_id') THEN
        ALTER TABLE employee_departments RENAME COLUMN departments_id TO department_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_departments' AND column_name = 'display_order') THEN
        ALTER TABLE employee_departments ADD COLUMN display_order int DEFAULT 0;
    END IF;

    -- manager_departments のリネーム (departments_id -> department_id)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manager_departments' AND column_name = 'departments_id') THEN
        ALTER TABLE manager_departments RENAME COLUMN departments_id TO department_id;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manager_departments' AND column_name = 'department_id') THEN
        ALTER TABLE manager_departments ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE CASCADE;
        UPDATE manager_departments md SET department_id = d.id FROM departments d 
        WHERE md.department = d.name AND d.tenant_id = (SELECT tenant_id FROM employees WHERE id = md.employee_id);
    END IF;

    -- 各コンテンツテーブルの標準化 (target_departments_id / target_department_id -> target_department_ids)
    -- announcements
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'target_departments_id') THEN
        ALTER TABLE announcements RENAME COLUMN target_departments_id TO target_department_ids;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'target_department_id') THEN
        ALTER TABLE announcements RENAME COLUMN target_department_id TO target_department_ids;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'target_department_ids') THEN
        ALTER TABLE announcements ADD COLUMN target_department_ids uuid[] DEFAULT '{}';
    END IF;

    -- compliance_documents
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'target_departments_id') THEN
        ALTER TABLE compliance_documents RENAME COLUMN target_departments_id TO target_department_ids;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'target_department_id') THEN
        ALTER TABLE compliance_documents RENAME COLUMN target_department_id TO target_department_ids;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'target_department_ids') THEN
        ALTER TABLE compliance_documents ADD COLUMN target_department_ids uuid[] DEFAULT '{}';
    END IF;

    -- trainings
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'target_departments_id') THEN
        ALTER TABLE trainings RENAME COLUMN target_departments_id TO target_department_ids;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'target_department_id') THEN
        ALTER TABLE trainings RENAME COLUMN target_department_id TO target_department_ids;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'target_department_ids') THEN
        ALTER TABLE trainings ADD COLUMN target_department_ids uuid[] DEFAULT '{}';
    END IF;
END $$;

-- 2. announcements
DROP POLICY IF EXISTS manager_manage_announcements ON announcements;
CREATE POLICY manager_manage_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_department_ids && (
        SELECT array_agg(department_id) 
        FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 3. compliance_documents
DROP POLICY IF EXISTS manager_manage_compliance ON compliance_documents;
CREATE POLICY manager_manage_compliance ON compliance_documents
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_department_ids && (
        SELECT array_agg(department_id) 
        FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 4. trainings
DROP POLICY IF EXISTS manager_manage_trainings ON trainings;
CREATE POLICY manager_manage_trainings ON trainings
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_department_ids && (
        SELECT array_agg(department_id) 
        FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 5. employees
DROP POLICY IF EXISTS manager_manage_subordinates ON employees;
CREATE POLICY manager_manage_subordinates ON employees
  FOR ALL
  USING (
    get_my_role() = 'manager' AND id IN (SELECT get_manager_subordinate_ids())
  );

-- 6. employee_departments (RLS の再構築 - テナントベース)
DROP POLICY IF EXISTS employee_depts_tenant_policy ON employee_departments;
DROP POLICY IF EXISTS admin_manage_employee_depts ON employee_departments;
DROP POLICY IF EXISTS manager_manage_subordinate_depts ON employee_departments;

CREATE POLICY employee_depts_tenant_access ON employee_departments
  FOR ALL
  TO authenticated
  USING (
    department_id IN (
      SELECT id FROM departments WHERE tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  )
  WITH CHECK (
    department_id IN (
      SELECT id FROM departments WHERE tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );

-- ==================== 044_fix_employee_schema.sql ====================
-- 044: employees テーブルのスキーマ修復
-- 400 Bad Request (column not found) 対策

DO $$ 
BEGIN
    -- 1. facility_id の確認と追加
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'facility_id') THEN
        ALTER TABLE employees ADD COLUMN facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL;
    END IF;

    -- 2. position_id の確認と追加
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'position_id') THEN
        ALTER TABLE employees ADD COLUMN position_id uuid REFERENCES positions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 既存のインデックスがなければ作成
CREATE INDEX IF NOT EXISTS idx_employees_facility_id ON employees(facility_id);
CREATE INDEX IF NOT EXISTS idx_employees_position_id ON employees(position_id);

-- RLSポリシーの再確認（社員が自分の情報を取得できるように）
-- 既存のポリシーを削除して再作成することで確実に適用する
DROP POLICY IF EXISTS "employee can read self" ON employees;
CREATE POLICY "employee can read self" ON employees
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "employee can update self" ON employees;
CREATE POLICY "employee can update self" ON employees
  FOR UPDATE USING (auth_user_id = auth.uid());

-- ==================== 045_unify_org_management.sql ====================
-- 045: マネージャーの管轄とコンテンツ配信を「施設（事業所）」ベースに移行

-- 1. manager_facilities テーブルの作成
-- マネージャー（employee_id）と担当施設（facility_id）を紐付ける
CREATE TABLE IF NOT EXISTS manager_facilities (
    employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
    facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (employee_id, facility_id)
);

-- RLS を有効化（テナントベース）
ALTER TABLE manager_facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY manager_facilities_tenant_access ON manager_facilities
  FOR ALL
  TO authenticated
  USING (
    facility_id IN (
      SELECT id FROM facilities WHERE tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );

-- 2. 既存データからの移行 (名前ベースのマッチング)
-- マネージャーが「部署」を担当している場合、同じ名前の「施設」にも自動的に紐付ける
INSERT INTO manager_facilities (employee_id, facility_id)
SELECT DISTINCT md.employee_id, f.id
FROM manager_departments md
JOIN departments d ON d.id = md.department_id
JOIN facilities f ON f.name = d.name AND f.tenant_id = d.tenant_id
ON CONFLICT (employee_id, facility_id) DO NOTHING;

-- 3. マネージャー管轄判定関数のアップデート (施設ベース)
-- get_manager_subordinate_ids を再定義
CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  -- マネージャー自身が担当する施設(manager_facilities)に
  -- 直属所属(facility_id)している社員、
  -- または旧来の「部署」ベースで紐付いている社員を合算して返す
  -- ※移行期間中につき両方サポート
  SELECT DISTINCT e.id
  FROM employees e
  LEFT JOIN manager_facilities mf ON mf.facility_id = e.facility_id
  LEFT JOIN employee_departments ed ON ed.employee_id = e.id
  LEFT JOIN manager_departments md ON md.department_id = ed.department_id
  WHERE (mf.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
         OR md.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1))
  AND e.tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. コンテンツテーブルの RLS ポリシー更新 (施設ベース管理者のサポート)

-- announcements
DROP POLICY IF EXISTS manager_manage_announcements ON announcements;
CREATE POLICY manager_manage_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      -- 配信対象施設がマネージャーの担当施設と重なっている
      target_facility_ids && (
        SELECT array_agg(facility_id) FROM manager_facilities 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
      OR
      -- (互換性維持) 配信対象部署がマネージャーの担当部署と重なっている
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- compliance_documents
DROP POLICY IF EXISTS manager_manage_compliance ON compliance_documents;
CREATE POLICY manager_manage_compliance ON compliance_documents
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_facility_ids && (
        SELECT array_agg(facility_id) FROM manager_facilities 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
      OR
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- trainings
DROP POLICY IF EXISTS manager_manage_trainings ON trainings;
CREATE POLICY manager_manage_trainings ON trainings
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_facility_ids && (
        SELECT array_agg(facility_id) FROM manager_facilities 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
      OR
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- ==================== 046_auto_include_own_facility.sql ====================
-- 046: 所属施設を自動的に管理管轄に含める改善
-- マネージャー自身の所属施設（employees.facility_id）を、manager_facilities への登録なしで管轄に含める

-- 1. 管轄判定関数のアップデート
CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  SELECT DISTINCT e.id
  FROM employees e
  LEFT JOIN manager_facilities mf ON mf.facility_id = e.facility_id
  LEFT JOIN employee_departments ed ON ed.employee_id = e.id
  LEFT JOIN manager_departments md ON md.department_id = ed.department_id
  WHERE (
    -- 1. 本人の所属施設と同じ施設に属する社員
    e.facility_id = (SELECT facility_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    OR 
    -- 2. 担当施設(manager_facilities)に属する社員
    mf.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    OR 
    -- 3. (互換性) 担当部署に属する社員
    md.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  )
  AND e.tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. コンテンツ RLS ポリシーの更新 (本人の所属施設を常に許可対象に含める)

-- announcements
DROP POLICY IF EXISTS manager_manage_announcements ON announcements;
CREATE POLICY manager_manage_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      -- 配信対象施設がマネージャーの「所属施設」または「担当施設」と重なっている
      target_facility_ids && (
        SELECT array_agg(id) FROM (
          SELECT facility_id as id FROM employees WHERE auth_user_id = auth.uid() AND facility_id IS NOT NULL
          UNION
          SELECT facility_id as id FROM manager_facilities WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
        ) as combined_facilities
      )
      OR
      -- (互換性維持) 配信対象部署がマネージャーの担当部署と重なっている
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- compliance_documents
DROP POLICY IF EXISTS manager_manage_compliance ON compliance_documents;
CREATE POLICY manager_manage_compliance ON compliance_documents
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_facility_ids && (
        SELECT array_agg(id) FROM (
          SELECT facility_id as id FROM employees WHERE auth_user_id = auth.uid() AND facility_id IS NOT NULL
          UNION
          SELECT facility_id as id FROM manager_facilities WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
        ) as combined_facilities
      )
      OR
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- trainings
DROP POLICY IF EXISTS manager_manage_trainings ON trainings;
CREATE POLICY manager_manage_trainings ON trainings
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_facility_ids && (
        SELECT array_agg(id) FROM (
          SELECT facility_id as id FROM employees WHERE auth_user_id = auth.uid() AND facility_id IS NOT NULL
          UNION
          SELECT facility_id as id FROM manager_facilities WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
        ) as combined_facilities
      )
      OR
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 8. employee_progress ビューの更新 (施設IDを追加して、マネージャーがフィルタリングしやすくする)
DROP VIEW IF EXISTS employee_progress;
CREATE VIEW employee_progress
WITH (security_invoker = true)
AS
  SELECT
    e.id AS employee_id,
    e.tenant_id,
    e.facility_id,
    (SELECT count(*) FROM document_submissions ds
      WHERE ds.employee_id = e.id AND ds.status = 'submitted') AS docs_submitted,
    (SELECT count(*) FROM compliance_acknowledgments ca
      WHERE ca.employee_id = e.id) AS compliance_done,
    (SELECT count(*) FROM training_submissions ts
      WHERE ts.employee_id = e.id AND ts.result = 'passed') AS trainings_passed,
    (SELECT count(*) FROM announcement_reads ar
      WHERE ar.employee_id = e.id) AS announcements_read
  FROM employees e;

-- ==================== 047_add_created_by_to_content.sql ====================
-- 047: コンテンツへの作成者情報追加
-- お知らせ、遵守事項、研修に作成者(created_by)を追加する

-- 1. カラムの追加
DO $$
BEGIN
    -- announcements
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'created_by') THEN
        ALTER TABLE announcements ADD COLUMN created_by uuid REFERENCES employees(id) ON DELETE SET NULL;
    END IF;

    -- compliance_documents
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'created_by') THEN
        ALTER TABLE compliance_documents ADD COLUMN created_by uuid REFERENCES employees(id) ON DELETE SET NULL;
    END IF;

    -- trainings
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'created_by') THEN
        ALTER TABLE trainings ADD COLUMN created_by uuid REFERENCES employees(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 2. 既存データへのデフォルト値設定 (必要であれば)
-- 既存のデータは管理者が作成したものとして扱う(任意)

-- 3. RLS ポリシーの微調整 (作成者自身による編集許可など、必要に応じて)
-- 現状のポリシーでマネージャーも自身がターゲットに含まれていれば操作可能だが、
-- 自身が作成したものは常に操作可能にするポリシーを追加しても良い

DROP POLICY IF EXISTS manager_edit_own_announcements ON announcements;
CREATE POLICY manager_edit_own_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS manager_edit_own_compliance ON compliance_documents;
CREATE POLICY manager_edit_own_compliance ON compliance_documents
  FOR ALL
  USING (
    get_my_role() = 'manager' AND created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS manager_edit_own_trainings ON trainings;
CREATE POLICY manager_edit_own_trainings ON trainings
  FOR ALL
  USING (
    get_my_role() = 'manager' AND created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

