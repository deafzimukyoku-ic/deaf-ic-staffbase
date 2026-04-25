-- 001: tenants テーブル
create table tenants (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  representative_title text not null,
  representative_name text not null,
  representative_honorific text not null default '様',
  -- 会社価値観（カルチャーフィット診断用）
  company_philosophy text,
  action_guidelines text,
  core_values text,
  valued_behaviors text,
  avoided_behaviors text,
  ideal_culture text,
  -- システム
  is_internal boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_status text,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at 自動更新トリガー
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tenants_updated_at
  before update on tenants
  for each row execute function update_updated_at();
