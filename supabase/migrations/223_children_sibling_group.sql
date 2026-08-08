-- 223_children_sibling_group.sql
-- 児童の兄弟グループ（docs/features/billing-configurable-items.md §3-4）
--
-- 背景:
--   利用料金表で「兄弟の請求額を合算して見たい」という要望。
--   ユーザー確定の見せ方は「各児童の行は個別金額のまま、兄弟グループごとの小計行を追加」。
--
-- 設計判断:
--   - グループを別テーブルにするのは、小計行の見出しに使う label を持たせるため
--     （children.sibling_group_id だけの uuid 共有だと名前が付けられない）。
--   - 姓の自動推定はしない。実 DB の児童名にはスペース区切りが無く、
--     先頭2文字一致では別世帯を誤結合しうるため、紐付けは職員が児童設定で明示的に行う。
--   - 施設スコープ。兄弟が別事業所に通うケースは今回の対象外（料金表が施設単位のため）。
--   - children.sibling_group_id は on delete set null。グループを消しても児童は消えない。
--
-- RLS: children / billing_fee_items と同一述語（admin 全域 / manager・shift_manager は管轄施設）。
-- storage 非変更のため storage-policy snapshot 不要。

create table if not exists public.sibling_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  /* 小計行の見出しに使う（例「川島」「◯◯家」） */
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, facility_id, label)
);

create index if not exists idx_sibling_groups_facility
  on public.sibling_groups(tenant_id, facility_id);

drop trigger if exists trg_sibling_groups_set_updated_at on public.sibling_groups;
create trigger trg_sibling_groups_set_updated_at
  before update on public.sibling_groups
  for each row execute function public.set_updated_at();

comment on table public.sibling_groups is
  '兄弟グループ（施設ごと）。利用料金表で兄弟の小計行を出すために使う。label は小計行の見出し。migration 223';

alter table public.children
  add column if not exists sibling_group_id uuid null
    references public.sibling_groups(id) on delete set null;

create index if not exists idx_children_sibling_group
  on public.children(sibling_group_id) where sibling_group_id is not null;

comment on column public.children.sibling_group_id is
  '兄弟グループ。null=単独。同一グループの児童は利用料金表で隣接表示され、直下に小計行が出る。migration 223';

-- ============================================================
-- RLS
-- ============================================================
alter table public.sibling_groups enable row level security;

drop policy if exists sg_admin_all on public.sibling_groups;
create policy sg_admin_all on public.sibling_groups for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists sg_manager_facility on public.sibling_groups;
create policy sg_manager_facility on public.sibling_groups for all
  using (
    get_my_role() = any (array['manager', 'shift_manager'])
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

/* employee は children を SELECT できる（children_employee_read）が、
   兄弟グループ名は請求都合の情報なので参照させない（policy を作らない）。
   children.sibling_group_id 自体は uuid のみで、employee には意味を持たない。 */
