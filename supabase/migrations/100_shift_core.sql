-- 100_shift_core.sql
-- Shift-Maker スキーマ統合（Phase 2）: テーブル・制約・enum・インデックス
-- 適用前に 090_drop_stripe_plan.sql, 091_manuals.sql が適用済みであること

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUM
-- ============================================================
drop type if exists publish_status cascade;
create type publish_status as enum ('draft', 'ready', 'published');

-- ============================================================
-- children
-- ============================================================
create table if not exists public.children (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null,
  grade_type text not null check (grade_type in (
    'preschool',
    'nursery_3','nursery_4','nursery_5',
    'elementary_1','elementary_2','elementary_3','elementary_4','elementary_5','elementary_6',
    'junior_high','junior_high_1','junior_high_2','junior_high_3',
    'high_1','high_2','high_3'
  )),
  is_active boolean not null default true,
  display_order integer,
  home_address text,
  parent_contact text,
  pickup_area_labels text[] not null default '{}',
  dropoff_area_labels text[] not null default '{}',
  custom_pickup_areas jsonb not null default '[]'::jsonb,
  custom_dropoff_areas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_children_tenant on public.children(tenant_id);
create index if not exists idx_children_facility on public.children(facility_id);
create index if not exists idx_children_tenant_order on public.children(tenant_id, display_order nulls last, created_at);

-- ============================================================
-- schedule_entries
-- ============================================================
create table if not exists public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  date date not null,
  pickup_time time,
  dropoff_time time,
  pickup_mark text,
  dropoff_mark text,
  is_confirmed boolean not null default false,
  attendance_status text not null default 'planned' check (attendance_status in ('planned','present','absent','late','early_leave')),
  attendance_updated_at timestamptz,
  attendance_updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, child_id, date)
);
create index if not exists idx_schedule_entries_tenant_date on public.schedule_entries(tenant_id, facility_id, date);
create index if not exists idx_schedule_entries_child on public.schedule_entries(child_id, date);
create index if not exists idx_schedule_entries_attendance on public.schedule_entries(tenant_id, facility_id, date, attendance_status);

-- ============================================================
-- shift_requests
-- ============================================================
create table if not exists public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  month text not null,
  request_type text not null check (request_type in ('public_holiday','paid_leave','available_day')),
  dates text[] not null default '{}',
  notes text,
  submitted_at timestamptz not null default now(),
  submitted_by uuid references public.employees(id) on delete set null,
  unique (tenant_id, facility_id, employee_id, month, request_type)
);
create index if not exists idx_shift_requests_tenant_month on public.shift_requests(tenant_id, facility_id, month);
create index if not exists idx_shift_requests_employee on public.shift_requests(employee_id, month);

-- ============================================================
-- shift_assignments（publish_status あり）
-- ============================================================
create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,
  segment_order integer not null default 0,
  assignment_type text not null check (assignment_type in ('normal','public_holiday','paid_leave','off')),
  is_confirmed boolean not null default false,
  publish_status publish_status not null default 'draft',
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, employee_id, date, segment_order)
);
create index if not exists idx_shift_assignments_tenant_date on public.shift_assignments(tenant_id, facility_id, date);
create index if not exists idx_shift_assignments_employee_date on public.shift_assignments(employee_id, date);
create index if not exists idx_shift_assignments_publish_status on public.shift_assignments(tenant_id, facility_id, publish_status);

-- ============================================================
-- transport_assignments（publish_status あり）
-- ============================================================
create table if not exists public.transport_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  schedule_entry_id uuid not null references public.schedule_entries(id) on delete cascade,
  direction text not null check (direction in ('pickup','dropoff')),
  employee_id uuid references public.employees(id) on delete set null,
  is_confirmed boolean not null default false,
  is_unassigned boolean not null default false,
  is_locked boolean not null default false,
  publish_status publish_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, schedule_entry_id, direction)
);
create index if not exists idx_transport_assignments_tenant on public.transport_assignments(tenant_id, facility_id);
create index if not exists idx_transport_assignments_entry on public.transport_assignments(schedule_entry_id);
create index if not exists idx_transport_assignments_employee on public.transport_assignments(employee_id);
create index if not exists idx_transport_assignments_locked on public.transport_assignments(tenant_id, facility_id, is_locked);
create index if not exists idx_transport_assignments_publish_status on public.transport_assignments(tenant_id, facility_id, publish_status);

-- ============================================================
-- shift_change_requests
-- ============================================================
create table if not exists public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_date date not null,
  change_type text not null check (change_type in ('time','leave','type_change')),
  requested_payload jsonb not null,
  snapshot_before jsonb,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by_employee_id uuid references public.employees(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_shift_change_requests_tenant_status on public.shift_change_requests(tenant_id, facility_id, status);
create index if not exists idx_shift_change_requests_employee on public.shift_change_requests(employee_id, target_date);

-- updated_at トリガー
create or replace function public.tg_shift_change_requests_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_shift_change_requests_updated_at on public.shift_change_requests;
create trigger trg_shift_change_requests_updated_at
  before update on public.shift_change_requests
  for each row execute function public.tg_shift_change_requests_updated_at();

-- ============================================================
-- attendance_audit_logs
-- ============================================================
create table if not exists public.attendance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  schedule_entry_id uuid not null references public.schedule_entries(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  entry_date date not null,
  changed_by_employee_id uuid references public.employees(id) on delete set null,
  changed_by_name text not null,
  old_status text,
  new_status text not null,
  changed_at timestamptz not null default now()
);
create index if not exists idx_attendance_audit_entry on public.attendance_audit_logs(schedule_entry_id, changed_at desc);
create index if not exists idx_attendance_audit_tenant_date on public.attendance_audit_logs(tenant_id, facility_id, entry_date desc);

-- ============================================================
-- child_area_eligible_staff
-- ============================================================
create table if not exists public.child_area_eligible_staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  area_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  direction text not null check (direction in ('pickup','dropoff')),
  created_at timestamptz not null default now(),
  unique (child_id, area_id, employee_id, direction)
);
create index if not exists idx_caes_child_dir_area on public.child_area_eligible_staff(child_id, direction, area_id);
create index if not exists idx_caes_employee on public.child_area_eligible_staff(employee_id);
create index if not exists idx_caes_tenant_facility on public.child_area_eligible_staff(tenant_id, facility_id);
