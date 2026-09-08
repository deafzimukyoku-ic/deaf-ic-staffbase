-- 226_schedule_day_notes.sql
-- 利用表（利用予定）の日付ヘッダ直下に置く「日別自由記入メモ 3 行」＋ 行ラベル
--
-- 背景: 先方要望（2026-09-08）。利用表でも行事を見ながら予定を組めるようにする。
-- 仕様: docs/features/schedule-fullwidth-notes-total.md
--
-- 設計判断:
--   - 当初はシフト表の shift_day_notes を共用する案だったが、先方から
--     「利用表はシフトとは別で入力できるようにしてほしい」と指示があったため**別テーブル**にする。
--     同じ日でも「シフト作成者に伝えたいこと」と「利用予定側の申し送り」は別物、という運用。
--   - 構造・制約・RLS は 219/220（shift_day_notes / shift_day_note_labels）と完全に同型にする。
--     将来どちらかを直すときに差分を考えなくて済むようにするため。
--   - 本文は「施設 × 日付 × 行番号」、ラベルは「施設 × 月 × 行番号」。
--     行事名は月単位で変わる想定（例: 6月は「学校行事」、7月は「会議」）なので月キーを持つ。
--   - 空文字はアプリ側で DELETE（ゴミ行を残さない）。未設定ラベルはアプリ側で「メモN」を表示。
--   - publish_status を持たない = シフト公開フローと独立（作成支援メモであり公開物ではない）。
--   - employee には SELECT ポリシーを与えない（管理側の作成支援メモ）。

-- ============================================================
-- (A) 本文（施設 × 日付 × 行番号）
-- ============================================================
create table if not exists public.schedule_day_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  date date not null,
  row_no smallint not null check (row_no in (1, 2, 3)),
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, facility_id, date, row_no)
);

create index if not exists idx_schedule_day_notes_facility_date
  on public.schedule_day_notes (facility_id, date);

comment on table public.schedule_day_notes is
  '226: 利用表の日別メモ（3行）。学校行事・施設行事・会議など。シフト表の shift_day_notes とは独立。';

-- updated_at 自動更新（188 の共通関数 set_updated_at を再利用）
drop trigger if exists trg_schedule_day_notes_set_updated_at on public.schedule_day_notes;
create trigger trg_schedule_day_notes_set_updated_at
  before update on public.schedule_day_notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- (B) 行ラベル（施設 × 月 × 行番号）
-- ============================================================
create table if not exists public.schedule_day_note_labels (
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

create index if not exists idx_schedule_day_note_labels_facility_month
  on public.schedule_day_note_labels (facility_id, month);

comment on table public.schedule_day_note_labels is
  '226: 利用表 日別メモの行ラベル（施設×月×行番号）。未設定時はアプリ側で「メモN」を表示。';

drop trigger if exists trg_schedule_day_note_labels_set_updated_at on public.schedule_day_note_labels;
create trigger trg_schedule_day_note_labels_set_updated_at
  before update on public.schedule_day_note_labels
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS: admin=テナント全域 / manager・shift_manager=管轄施設のみ / employee=なし
-- 219/220 と同一述語を**直接記述**する（migration 140 の上書きに依存しない。222 と同じ方針）
-- ============================================================

alter table public.schedule_day_notes enable row level security;

drop policy if exists sched_dn_admin_all on public.schedule_day_notes;
create policy sched_dn_admin_all on public.schedule_day_notes for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id())
  with check (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists sched_dn_manager_facility on public.schedule_day_notes;
create policy sched_dn_manager_facility on public.schedule_day_notes for all
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

alter table public.schedule_day_note_labels enable row level security;

drop policy if exists sched_dnl_admin_all on public.schedule_day_note_labels;
create policy sched_dnl_admin_all on public.schedule_day_note_labels for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id())
  with check (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists sched_dnl_manager_facility on public.schedule_day_note_labels;
create policy sched_dnl_manager_facility on public.schedule_day_note_labels for all
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
