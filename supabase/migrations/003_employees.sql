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
