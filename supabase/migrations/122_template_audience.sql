-- 122_template_audience.sql
--
-- 書類テンプレの配布対象を、書類自体に直接持たせるシンプルなモデル。
--
-- 設計:
--   - 1 書類につき 0..N 行
--   - 0 行 = 「全員対象」（デフォルト・互換）
--   - 1 行以上 = いずれかのルールに該当する社員のみ対象（OR セマンティクス）
--   - ルール種別:
--       flag     : employees の boolean 列で判定 (rule_value: 列名)
--       facility : 所属施設で判定 (rule_value: facility_id)
--       role     : ロールで判定 (rule_value: 'admin' | 'manager' | 'employee')
--       employee : 個別社員指名 (rule_value: employee_id)

-- ============================================================
-- 0. 旧 122 (employee_groups モデル) のクリーンアップ
--    旧版が誤って先に流れた環境を救済するため idempotent に書く。
--    新規 DB では DROP IF EXISTS が no-op。
-- ============================================================

drop trigger if exists trg_seed_default_employee_group on public.tenants;
drop function if exists public._seed_default_employee_group();
drop table if exists public.document_template_groups cascade;
drop table if exists public.employee_groups cascade;
drop function if exists public._touch_employee_groups_updated_at();

-- ============================================================
-- 1. 本体テーブル
-- ============================================================

create table if not exists public.document_template_audience (
  template_id uuid not null references public.document_templates(id) on delete cascade,
  rule_type text not null check (rule_type in ('flag', 'facility', 'role', 'employee')),
  rule_value text not null,
  created_at timestamptz not null default now(),
  primary key (template_id, rule_type, rule_value)
);

create index if not exists idx_dta_template on public.document_template_audience(template_id);
create index if not exists idx_dta_rule on public.document_template_audience(rule_type, rule_value);

comment on table public.document_template_audience is
  '書類テンプレの配布対象ルール。0 行 = 全員対象、1 行以上 = OR 条件。'
  ' rule_type: flag/facility/role/employee。詳細は lib/template-audience.ts';

-- ============================================================
-- RLS: 全 tenant 横断の制御は document_templates.tenant_id に依存
-- ============================================================

alter table public.document_template_audience enable row level security;

create policy "tenant members read template audience"
  on public.document_template_audience for select
  using (
    template_id in (select id from public.document_templates where tenant_id = public.get_my_tenant_id())
  );

create policy "admin/manager manage template audience"
  on public.document_template_audience for all
  using (
    template_id in (select id from public.document_templates where tenant_id = public.get_my_tenant_id())
    and public.get_my_role() in ('admin', 'manager')
  )
  with check (
    template_id in (select id from public.document_templates where tenant_id = public.get_my_tenant_id())
    and public.get_my_role() in ('admin', 'manager')
  );
