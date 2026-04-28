-- 127_events.sql
-- Phase 66-B: イベント設定（利用料金表に料金として乗るイベント）
-- - 各 facility ごとに「日付 + 名前 + 金額」を CRUD
-- - 利用料金表で月単位の列ヘッダとして使用される
-- - 児童ごとの参加判定は billing_event_participations で別管理（migration 128）
--   ここではイベント自体の master 定義のみ

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  date date not null,
  name text not null,
  price integer not null check (price >= 0),
  display_order integer,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, date, name)
);
create index if not exists idx_events_facility_date on public.events(tenant_id, facility_id, date);

comment on table public.events is
  'Phase 66-B: 利用料金表に出るイベント（ピザづくり / お祝い会 等）。日付 + 名前 + 金額。';
comment on column public.events.price is '円。0 以上の整数。';

-- RLS（schedule_entries 等と同じパターン: admin 全権 / manager 自 facility / employee 不可）
alter table public.events enable row level security;

drop policy if exists ev_admin_all on public.events;
create policy ev_admin_all on public.events for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists ev_manager_facility on public.events;
create policy ev_manager_facility on public.events for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

-- employee は events を参照しない想定（料金表の閲覧は admin/manager 権限のため）
