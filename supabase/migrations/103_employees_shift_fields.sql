-- 103_employees_shift_fields.sql
-- Phase 3: shift-maker の staff 固有カラムを employees に統合

-- 雇用形態・勤務時間・送迎エリア・資格・運転手/添乗フラグ
alter table public.employees
  add column if not exists employment_type text default 'part_time' check (employment_type in ('full_time','part_time')),
  add column if not exists default_start_time time,
  add column if not exists default_end_time time,
  add column if not exists pickup_transport_areas text[] not null default '{}'::text[],
  add column if not exists dropoff_transport_areas text[] not null default '{}'::text[],
  add column if not exists is_qualified boolean not null default false,
  add column if not exists is_driver boolean not null default false,
  add column if not exists is_attendant boolean not null default false,
  add column if not exists shift_display_order integer;

comment on column public.employees.employment_type is 'full_time / part_time';
comment on column public.employees.pickup_transport_areas is '迎の対応エリアラベル配列';
comment on column public.employees.dropoff_transport_areas is '送の対応エリアラベル配列';
comment on column public.employees.is_qualified is '有資格者フラグ（シフト生成時の有資格者最低人数に使用）';
comment on column public.employees.is_driver is '運転手フラグ（送迎割当の主担当候補）';
comment on column public.employees.is_attendant is '付き添いフラグ（送迎割当の副担当候補）';

-- 施設ごとのシフト設定（有資格者最低人数・営業エリアラベルなど）
create table if not exists public.facility_shift_settings (
  facility_id uuid primary key references public.facilities(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  min_qualified_staff integer not null default 2,
  pickup_area_labels jsonb not null default '[]'::jsonb,
  dropoff_area_labels jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_fss_tenant on public.facility_shift_settings(tenant_id);

alter table public.facility_shift_settings enable row level security;

drop policy if exists fss_select on public.facility_shift_settings;
create policy fss_select on public.facility_shift_settings for select
  using (tenant_id = get_my_tenant_id());

drop policy if exists fss_admin_all on public.facility_shift_settings;
create policy fss_admin_all on public.facility_shift_settings for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists fss_manager_own on public.facility_shift_settings;
create policy fss_manager_own on public.facility_shift_settings for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );
