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
