-- 128_billing.sql
-- Phase 66-C: 月次「利用料金表」の永続化
-- - billing_summaries: 児童 × 月のサマリ（出席日数 / 利用負担額 / おやつ / 公文 / イベント合計 / 請求合計 / 受取日）
-- - billing_event_participations: サマリ × イベント の参加チェック + 金額スナップショット
-- 月締め＝「保存」ボタンで upsert される。再印刷時は同じ数字が出る（schedule_entries の事後変更に左右されない）。

-- ============================================================
-- billing_summaries
-- ============================================================
create table if not exists public.billing_summaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  child_id uuid not null references public.children(id) on delete cascade,
  /* 月次集計の数値（再生成時の上書き対象）*/
  attendance_days integer not null default 0,
  /* 利用負担額: null は「—」（無償化または公費 0）。0 と区別するため nullable */
  copay_amount integer null check (copay_amount is null or copay_amount >= 0),
  snack_fee integer not null default 0 check (snack_fee >= 0),
  kumon_fee integer not null default 0 check (kumon_fee >= 0),
  event_total integer not null default 0 check (event_total >= 0),
  total_amount integer not null default 0 check (total_amount >= 0),
  /* 受取（入金）日: 手動入力。null=未入金 */
  received_at date null,
  /* 月次時点のスナップショット（後から児童属性が変わっても紙の数字は守る）*/
  child_name_snapshot text,
  child_municipality_snapshot text,
  saved_at timestamptz not null default now(),
  saved_by_employee_id uuid null references public.employees(id) on delete set null,
  unique (tenant_id, facility_id, year, month, child_id)
);
create index if not exists idx_billing_summaries_facility_month
  on public.billing_summaries(tenant_id, facility_id, year, month);

comment on table public.billing_summaries is
  'Phase 66-C: 月次利用料金表のサマリ。年月×児童で 1 行。保存時に upsert。';
comment on column public.billing_summaries.copay_amount is
  '利用負担額（円）。null は「—」表示（無償化や公費全額負担）。';
comment on column public.billing_summaries.received_at is '受取（入金）日。null=未入金。';

-- ============================================================
-- billing_event_participations
-- ============================================================
create table if not exists public.billing_event_participations (
  id uuid primary key default gen_random_uuid(),
  billing_summary_id uuid not null references public.billing_summaries(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  participated boolean not null default false,
  /* 月次時点の金額スナップショット。events.price が後で変わっても紙は守る */
  amount integer not null default 0 check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (billing_summary_id, event_id)
);
create index if not exists idx_billing_event_participations_summary
  on public.billing_event_participations(billing_summary_id);

comment on table public.billing_event_participations is
  'Phase 66-C: 月次サマリ × イベント の参加チェック + 金額スナップショット。';

-- ============================================================
-- RLS（events と同じパターン）
-- ============================================================
alter table public.billing_summaries enable row level security;

drop policy if exists bs_admin_all on public.billing_summaries;
create policy bs_admin_all on public.billing_summaries for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists bs_manager_facility on public.billing_summaries;
create policy bs_manager_facility on public.billing_summaries for all
  using (
    get_my_role() = 'manager'
    and tenant_id = get_my_tenant_id()
    and facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

alter table public.billing_event_participations enable row level security;

/* event_participations は親 (billing_summaries) の RLS で実質的に制御されるが、
   行レベルで明示的にチェックする（join 経由ではなく親 id をたどってチェック）。 */
drop policy if exists bep_admin_all on public.billing_event_participations;
create policy bep_admin_all on public.billing_event_participations for all
  using (
    get_my_role() = 'admin'
    and exists (
      select 1 from public.billing_summaries bs
      where bs.id = billing_event_participations.billing_summary_id
        and bs.tenant_id = get_my_tenant_id()
    )
  );

drop policy if exists bep_manager_facility on public.billing_event_participations;
create policy bep_manager_facility on public.billing_event_participations for all
  using (
    get_my_role() = 'manager'
    and exists (
      select 1 from public.billing_summaries bs
      where bs.id = billing_event_participations.billing_summary_id
        and bs.tenant_id = get_my_tenant_id()
        and bs.facility_id = (select facility_id from public.employees where auth_user_id = auth.uid() limit 1)
    )
  );
