-- 227_daily_report_notes.sql
-- 業務日報「活動内容／連絡事項」枠の**日ごと**自由入力
--
-- 背景: 先方要望（2026-09-08）「業務日報ページから直接入力できると嬉しい」。
-- 仕様: docs/features/daily-report-free-input.md
--
-- 現状（migration 121）は facilities.daily_report_template ＝ 事業所ごとの**固定テンプレート**しか無く、
-- 全日付に同じ文言が出るだけだった。その日の活動を記録する場所が無い。
--
-- 設計判断:
--   - 「施設 × 日付」で 1 レコード（行番号は持たない。日報の枠は 1 つの自由記述欄なので）。
--     利用表・シフト表のメモ（3 行・行ラベル付き）とは用途が違うため別テーブルにする。
--   - 空文字はアプリ側で DELETE（ゴミ行を残さない）。
--   - facilities.daily_report_template は**残す**。印字順は
--     「テンプレート（毎日共通） → 利用表のメモ（参照表示） → この日の自由入力」。
--   - RLS は 226 と同型（admin=テナント全域 / manager・shift_manager=管轄施設 / employee なし）。
--     employee は業務日報画面自体に入れない。

create table if not exists public.daily_report_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  date date not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, facility_id, date)
);

create index if not exists idx_daily_report_notes_facility_date
  on public.daily_report_notes (facility_id, date);

comment on table public.daily_report_notes is
  '227: 業務日報「活動内容／連絡事項」枠の日別自由入力（施設×日付で1件）。'
  '事業所共通の定型文は facilities.daily_report_template（121）側。';

-- updated_at 自動更新（188 の共通関数 set_updated_at を再利用）
drop trigger if exists trg_daily_report_notes_set_updated_at on public.daily_report_notes;
create trigger trg_daily_report_notes_set_updated_at
  before update on public.daily_report_notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- RLS: admin=テナント全域 / manager・shift_manager=管轄施設のみ / employee=なし
-- 述語は 222 / 226 と同じ方針で**直接記述**し migration 140 の上書きに依存しない
-- ============================================================

alter table public.daily_report_notes enable row level security;

drop policy if exists drn_admin_all on public.daily_report_notes;
create policy drn_admin_all on public.daily_report_notes for all
  using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id())
  with check (get_my_role() = 'admin' and tenant_id = get_my_tenant_id());

drop policy if exists drn_manager_facility on public.daily_report_notes;
create policy drn_manager_facility on public.daily_report_notes for all
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
