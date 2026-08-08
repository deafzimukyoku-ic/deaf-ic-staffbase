-- 222_billing_fee_items.sql
-- 利用料金表の請求項目を可変化する（docs/features/billing-configurable-items.md §3）
--
-- 背景:
--   請求項目は「おやつ等 = 出席日数 × SNACK_FEE_PER_DAY(50)」「教材印刷代 = children.kumon_monthly_fee」
--   のようにコード側にハードコードされており、事業所が項目を足す/抜く/改名することができなかった。
--   これを施設ごとのマスタに一般化し、④「他施設利用」も checkbox 型の 1 項目として同じ仕組みに載せる。
--
-- 設計判断:
--   - 計算方式は 4 種（per_day / per_child_monthly / monthly_fixed / checkbox）。
--     UI で式を再実装せず lib/logic/computeBilling.ts の resolveFeeAmount() に一元化する。
--   - amount_override は null=自動算出 / not null=その月は固定。**0 と null は別物**（0 = 手動で 0 円）。
--     migration 221 の snack_fee_override で確立した規約をそのまま一般化する。コード側は ?? で判定し || を使わない。
--   - 過去月の紙を守るため、月次の実効額は billing_summary_fee_amounts.amount にスナップショットする。
--     マスタの単価を後から変えても、保存済みの月の金額は変わらない。
--   - system_key は移行でシードした組込項目の固定キー。施設ごとに 1 つまで（部分 UNIQUE INDEX）。
--     これによりデータ移行スクリプトが冪等になる。手動追加の項目は null。
--
-- RLS: 既存の請求系（billing_summaries / events）と同一述語を直接書く。
--      shift_manager も編集可（2026-08-08 ユーザー承認）。実 DB の pg_policies.qual を
--      scripts/probe-billing-policies.mjs で確認した現行世代に合わせている。
--      migration 140 の上書きに依存しない（CLAUDE.md §16-2「ポリシー名で世代を判断しない」）。
--
-- storage 非変更のため storage-policy snapshot 不要。

-- ============================================================
-- billing_fee_items — 請求項目マスタ（施設スコープ）
-- ============================================================
create table if not exists public.billing_fee_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null,
  calc_type text not null
    check (calc_type in ('per_day', 'per_child_monthly', 'monthly_fixed', 'checkbox')),
  /* per_day=単価/日 / monthly_fixed=月額 / checkbox=チェック時の加算額。
     per_child_monthly は children_fee_amounts が正で、この列は使わない（0 のまま） */
  unit_amount integer not null default 0 check (unit_amount >= 0),
  /* ▲▼ の 1 ステップ幅（円）。null なら unit_amount を 1 ステップとして扱う */
  step_amount integer null check (step_amount is null or step_amount > 0),
  /* 移行でシードした組込項目の固定キー: 'snack' | 'material' | 'other_facility'。手動追加は null */
  system_key text null,
  is_active boolean not null default true,
  display_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, facility_id, name)
);

/* system_key は施設ごとに 1 つまで。移行スクリプトの冪等性（再実行しても重複シードしない）の担保 */
create unique index if not exists uq_billing_fee_items_system_key
  on public.billing_fee_items(tenant_id, facility_id, system_key)
  where system_key is not null;

create index if not exists idx_billing_fee_items_facility
  on public.billing_fee_items(tenant_id, facility_id, is_active, display_order);

drop trigger if exists trg_billing_fee_items_set_updated_at on public.billing_fee_items;
create trigger trg_billing_fee_items_set_updated_at
  before update on public.billing_fee_items
  for each row execute function public.set_updated_at();

comment on table public.billing_fee_items is
  '利用料金表の請求項目マスタ（施設ごと）。おやつ等 / 教材印刷代 / 他施設利用 などを設定から足し引きできる。migration 222';
comment on column public.billing_fee_items.calc_type is
  'per_day=出席日数×unit_amount / per_child_monthly=児童ごとの月額(children_fee_amounts) / monthly_fixed=月額固定 / checkbox=チェックONでunit_amount加算';
comment on column public.billing_fee_items.system_key is
  '移行でシードした組込項目の固定キー（snack / material / other_facility）。施設ごとに1つまで。手動追加項目は null。';
comment on column public.billing_fee_items.is_active is
  'false にすると以後の月の列から外れる。過去月は billing_summary_fee_amounts のスナップショットが残るため金額は変わらない。';

-- ============================================================
-- children_fee_amounts — per_child_monthly 項目の児童別金額
-- ============================================================
create table if not exists public.children_fee_amounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  fee_item_id uuid not null references public.billing_fee_items(id) on delete cascade,
  amount integer not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, fee_item_id)
);

create index if not exists idx_children_fee_amounts_item
  on public.children_fee_amounts(fee_item_id);

drop trigger if exists trg_children_fee_amounts_set_updated_at on public.children_fee_amounts;
create trigger trg_children_fee_amounts_set_updated_at
  before update on public.children_fee_amounts
  for each row execute function public.set_updated_at();

comment on table public.children_fee_amounts is
  'calc_type=per_child_monthly の請求項目について、児童ごとの月額（円）。児童設定画面で入力する。migration 222';

-- ============================================================
-- billing_summary_fee_amounts — 児童 × 月 × 項目 の実績・調整・スナップショット
-- ============================================================
create table if not exists public.billing_summary_fee_amounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  billing_summary_id uuid not null references public.billing_summaries(id) on delete cascade,
  /* 過去月の紙を守るため RESTRICT。スナップショットを持つ項目は物理削除できない
     （UI は「有効 OFF」を案内する）。settings 側 (children_fee_amounts) は cascade で消えてよい。 */
  fee_item_id uuid not null references public.billing_fee_items(id) on delete restrict,
  /* calc_type=checkbox のときのみ意味を持つ */
  checked boolean not null default false,
  /* 手動調整額。null=自動算出（出席日数・マスタ単価に追従）/ not null=その月は固定。
     0（手動で0円に固定）と null（自動）は別物。コード側は ?? で判定し || を使わない。 */
  amount_override integer null check (amount_override is null or amount_override >= 0),
  /* 実効額のスナップショット（保存時点の確定値） */
  amount integer not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (billing_summary_id, fee_item_id)
);

create index if not exists idx_billing_summary_fee_amounts_summary
  on public.billing_summary_fee_amounts(billing_summary_id);
create index if not exists idx_billing_summary_fee_amounts_item
  on public.billing_summary_fee_amounts(fee_item_id);

comment on table public.billing_summary_fee_amounts is
  '月次サマリ × 請求項目 の実績（checkbox の ON/OFF・手動調整額・実効額スナップショット）。migration 222';
comment on column public.billing_summary_fee_amounts.amount_override is
  'null=自動算出（出席日数やマスタ単価に追従）/ not null=その月は固定。0 は「手動で0円」を意味し null と区別する。';

-- ============================================================
-- RLS（billing_summaries / events と同一述語）
-- ============================================================
alter table public.billing_fee_items enable row level security;

drop policy if exists bfi_admin_all on public.billing_fee_items;
create policy bfi_admin_all on public.billing_fee_items for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists bfi_manager_facility on public.billing_fee_items;
create policy bfi_manager_facility on public.billing_fee_items for all
  using (
    get_my_role() = any (array['manager', 'shift_manager'])
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

alter table public.children_fee_amounts enable row level security;

drop policy if exists cfa_admin_all on public.children_fee_amounts;
create policy cfa_admin_all on public.children_fee_amounts for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists cfa_manager_facility on public.children_fee_amounts;
create policy cfa_manager_facility on public.children_fee_amounts for all
  using (
    get_my_role() = any (array['manager', 'shift_manager'])
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

alter table public.billing_summary_fee_amounts enable row level security;

/* 親 (billing_summaries) を join せず自列の facility_id で判定する。
   billing_event_participations の exists 方式より単純で、行レベルで閉じる。 */
drop policy if exists bsfa_admin_all on public.billing_summary_fee_amounts;
create policy bsfa_admin_all on public.billing_summary_fee_amounts for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists bsfa_manager_facility on public.billing_summary_fee_amounts;
create policy bsfa_manager_facility on public.billing_summary_fee_amounts for all
  using (
    get_my_role() = any (array['manager', 'shift_manager'])
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );

-- employee は請求項目・料金表を参照しない（既存の billing 系と同じく policy を作らない）
