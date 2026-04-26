-- 123_profile_section_visibility.sql
--
-- 「設定 → 表示設定」タブで管理する、プロフィール画面のセクション表示制御テーブル。
-- 過去の migration から漏れていたため、コードからは参照されているが実体が無い状態だった。
-- idempotent に書く（既に存在する環境でも安全）。
--
-- 参照箇所:
--   app/(admin)/admin/settings/page.tsx (load + save)
--   app/api/field-visibility/route.ts

create table if not exists public.profile_section_visibility (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  section_key text not null,
  is_visible boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, section_key)
);

create index if not exists idx_psv_tenant on public.profile_section_visibility(tenant_id);

comment on table public.profile_section_visibility is
  '社員プロフィール画面の各セクションの表示/非表示設定（tenant 単位）。'
  ' section_key は lib/constants.ts の PROFILE_SECTION_KEYS と一致。';

-- updated_at 自動更新
create or replace function public._touch_psv_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_psv_updated_at on public.profile_section_visibility;
create trigger trg_psv_updated_at
  before update on public.profile_section_visibility
  for each row execute function public._touch_psv_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.profile_section_visibility enable row level security;

drop policy if exists "tenant members read profile section visibility" on public.profile_section_visibility;
create policy "tenant members read profile section visibility"
  on public.profile_section_visibility for select
  using (tenant_id = public.get_my_tenant_id());

drop policy if exists "admin/manager manage profile section visibility" on public.profile_section_visibility;
create policy "admin/manager manage profile section visibility"
  on public.profile_section_visibility for all
  using (tenant_id = public.get_my_tenant_id() and public.get_my_role() in ('admin', 'manager'))
  with check (tenant_id = public.get_my_tenant_id() and public.get_my_role() in ('admin', 'manager'));
