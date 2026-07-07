-- 220_shift_day_notes_3rows_and_labels.sql
-- 先方要望②の拡張（2026-07-07）:
--   (A) シフト表の日別メモを 2 行 → 3 行に拡張（row_no CHECK を 1,2,3 へ）
--   (B) メモ行の名称（「メモ1/2/3」）を施設×月ごとに変更可能にする新テーブル
--
-- 仕様: docs/features/shift-notes-copypaste-crossfacility.md
--
-- 設計判断:
--   - ラベルは「施設 × 月 × 行番号」で 1 レコード（本文 shift_day_notes は「施設 × 日付 × 行番号」）。
--     行事名は月単位で変わる想定（例: 6月は「学校行事」、7月は「会議」）なので月キーを持つ。
--   - 未設定時はアプリ側で「メモ1/2/3」をデフォルト表示（空行を作らない）。

-- ============================================================
-- (A) row_no を 3 行まで許可
-- ============================================================
alter table public.shift_day_notes drop constraint if exists shift_day_notes_row_no_check;
alter table public.shift_day_notes
  add constraint shift_day_notes_row_no_check check (row_no in (1, 2, 3));

-- ============================================================
-- (B) 日別メモの行ラベル（施設 × 月 × 行番号）
-- ============================================================
create table if not exists public.shift_day_note_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),  -- 'YYYY-MM'
  row_no smallint not null check (row_no in (1, 2, 3)),
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, facility_id, month, row_no)
);

create index if not exists idx_shift_day_note_labels_facility_month
  on public.shift_day_note_labels (facility_id, month);

comment on table public.shift_day_note_labels is
  '220: シフト表 日別メモの行ラベル（施設×月×行番号）。未設定時はアプリ側で「メモN」を表示。';

-- updated_at 自動更新（188 の共通関数を再利用）
drop trigger if exists trg_shift_day_note_labels_set_updated_at on public.shift_day_note_labels;
create trigger trg_shift_day_note_labels_set_updated_at
  before update on public.shift_day_note_labels
  for each row execute function public.set_updated_at();

-- RLS: shift_day_notes(219) と同型（admin=テナント全域 / manager・shift_manager=管轄施設 / employee なし）
alter table public.shift_day_note_labels enable row level security;

drop policy if exists sdnl_admin_all on public.shift_day_note_labels;
create policy sdnl_admin_all on public.shift_day_note_labels for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id())
  with check (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists sdnl_manager_facility on public.shift_day_note_labels;
create policy sdnl_manager_facility on public.shift_day_note_labels for all
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
