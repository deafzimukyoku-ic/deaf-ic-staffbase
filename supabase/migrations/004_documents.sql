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
