-- 002: tenant_payroll_banks テーブル
create table tenant_payroll_banks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  bank_name text not null,
  display_order integer not null default 0,
  is_default boolean not null default false
);

create index idx_payroll_banks_tenant on tenant_payroll_banks(tenant_id);
