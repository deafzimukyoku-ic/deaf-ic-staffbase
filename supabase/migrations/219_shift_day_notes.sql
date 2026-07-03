-- 219_shift_day_notes.sql
-- シフト表の日付ヘッダ直下に置く「日別自由記入メモ 2 行」（学校行事・施設行事・会議など）
--
-- 背景: 納品先要望①（2026-07-03）。シフト作成時に行事を見ながら組めるようにする。
-- 仕様: docs/features/shift-notes-copypaste-crossfacility.md
--
-- 設計判断:
--   - 行は日付×行番号(1|2)で1レコード。空文字はアプリ側で DELETE（ゴミ行を残さない）
--   - publish_status を持たない = シフト公開フローと独立（作成メモであり公開物ではない）
--   - employee には SELECT ポリシーを与えない（管理側の作成支援メモ。将来公開する場合は別 migration で追加）

create table if not exists public.shift_day_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  date date not null,
  row_no smallint not null check (row_no in (1, 2)),
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, facility_id, date, row_no)
);

create index if not exists idx_shift_day_notes_facility_date
  on public.shift_day_notes (facility_id, date);

comment on table public.shift_day_notes is
  '219: シフト表の日別メモ（2行）。学校行事・施設行事・会議など。シフト作成支援用で公開フロー非連動。';

-- updated_at 自動更新（188 の共通関数 set_updated_at を再利用）
drop trigger if exists trg_shift_day_notes_set_updated_at on public.shift_day_notes;
create trigger trg_shift_day_notes_set_updated_at
  before update on public.shift_day_notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS: admin=テナント全域 / manager・shift_manager=管轄施設のみ / employee=なし
-- （shift_assignments の facility 系ポリシー 101/131/140 と同型）
-- ============================================================

alter table public.shift_day_notes enable row level security;

drop policy if exists sdn_admin_all on public.shift_day_notes;
create policy sdn_admin_all on public.shift_day_notes for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id())
  with check (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists sdn_manager_facility on public.shift_day_notes;
create policy sdn_manager_facility on public.shift_day_notes for all
  using (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  )
  with check (
    get_my_role() in ('manager', 'shift_manager')
    and tenant_id = get_my_tenant_id()
    and facility_id in (select get_my_managed_facility_ids())
  );
