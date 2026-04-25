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
