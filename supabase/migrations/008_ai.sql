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
