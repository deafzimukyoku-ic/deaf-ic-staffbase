-- 216: シフト「確認しました」機能 + ready 可視化
-- docs/features/shift-confirmation-and-badge.md
--
-- (1) shift_confirmations: 職員が (施設 × 月) の仮/公開シフトを確認した記録
-- (2) RLS: 本人 SELECT/INSERT/UPDATE + manager/admin DELETE(再遷移時のリセット用)
-- (3) migration 160 sa_employee_facility_shifts を ready も含むよう拡張
--     （職員が施設全員分の「仮シフト(ready)」をレビューできるようにする＝案Zの本来の狙い）
--
-- 安全性メモ: (3) は shift_assignments の SELECT 範囲を広げるだけ。
--   employees テーブルや auth には一切触れないため、144/145 の「全員ログアウト」とは別物。

begin;

-- ============================================================
-- (1) shift_confirmations テーブル
-- ============================================================
create table if not exists public.shift_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  month text not null,                       -- 'YYYY-MM'
  confirmed_count integer not null default 1,
  confirmed_at timestamptz not null default now(),
  unique (employee_id, facility_id, month)
);

comment on table public.shift_confirmations is
  '職員が施設×月の仮(ready)/公開(published)シフトを「確認しました」と押した記録。再 ready/再公開時に当該(施設,月)分を delete してリセットする。';

create index if not exists idx_shift_confirmations_emp on public.shift_confirmations (employee_id, month);
create index if not exists idx_shift_confirmations_fac_month on public.shift_confirmations (facility_id, month);

alter table public.shift_confirmations enable row level security;

-- 本人: 自分の確認のみ閲覧
drop policy if exists sc_employee_select on public.shift_confirmations;
create policy sc_employee_select on public.shift_confirmations for select
  using (
    tenant_id = get_my_tenant_id()
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  );

-- 本人: 自分 × 自所属施設(主+兼任) の確認を記録
drop policy if exists sc_employee_insert on public.shift_confirmations;
create policy sc_employee_insert on public.shift_confirmations for insert
  with check (
    tenant_id = get_my_tenant_id()
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
    and facility_id in (select get_my_facility_ids())
  );

drop policy if exists sc_employee_update on public.shift_confirmations;
create policy sc_employee_update on public.shift_confirmations for update
  using (
    tenant_id = get_my_tenant_id()
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  )
  with check (
    tenant_id = get_my_tenant_id()
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
    and facility_id in (select get_my_facility_ids())
  );

-- admin: テナント内の確認を delete（リセット）
drop policy if exists sc_admin_delete on public.shift_confirmations;
create policy sc_admin_delete on public.shift_confirmations for delete
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

-- manager / shift_manager: 自管轄施設の確認を delete（リセット）
drop policy if exists sc_manager_delete on public.shift_confirmations;
create policy sc_manager_delete on public.shift_confirmations for delete
  using (
    get_my_role() = any (array['manager', 'shift_manager'])
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- ============================================================
-- (3) 160 拡張: employee が施設の ready/published シフトを閲覧可能に
-- ============================================================
drop policy if exists sa_employee_facility_shifts on public.shift_assignments;
create policy sa_employee_facility_shifts on public.shift_assignments for select
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and publish_status in ('ready'::publish_status, 'published'::publish_status)
    and facility_id in (select get_my_facility_ids())
  );

commit;

notify pgrst, 'reload schema';
