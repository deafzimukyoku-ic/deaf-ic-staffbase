-- 126_children_billing_fields.sql
-- Phase 66-A: 利用料金表（月次請求）算出のために children に料金属性を追加
-- - municipality: 市町村（PDF 「市町村」列）。'名古屋市' のとき preschool も無償化対象になるため判定に使用
-- - copay_tier: 利用者上限負担額の階層（zero / 4600 / 37200 / freeform）
-- - copay_freeform_amount: copay_tier='freeform' のときの円額（自然数）
-- - kumon_monthly_fee: 公文代（教材印刷代相当）の月額（円、自然数、施設・児童ごとに自由設定）。null=計上しない
--
-- 設計判断:
-- - 1日単価は持たない（実際の利用負担額の精緻計算はデイロボ側で行い、月次の料金表ページで手動入力）
-- - 公文代は施設・児童ごとに金額が違う（¥2,000 とは限らない）ため自由入力

alter table public.children
  add column if not exists municipality text null,
  add column if not exists copay_tier text not null default 'zero',
  add column if not exists copay_freeform_amount integer null,
  add column if not exists kumon_monthly_fee integer null;

-- 旧仕様の名残（過去の本マイグレーション草案で追加された場合の互換のため drop）。
alter table public.children drop column if exists daily_unit_cost;
alter table public.children drop column if exists kumon_enabled;

-- copay_tier の許容値
alter table public.children
  drop constraint if exists children_copay_tier_check;
alter table public.children
  add constraint children_copay_tier_check
  check (copay_tier in ('zero', '4600', '37200', 'freeform'));

-- copay_freeform_amount: tier='freeform' のときに正の整数を期待。null 許容（freeform 以外は null 推奨）
alter table public.children
  drop constraint if exists children_copay_freeform_amount_range;
alter table public.children
  add constraint children_copay_freeform_amount_range
  check (
    copay_freeform_amount is null
    or (copay_freeform_amount > 0)
  );

-- kumon_monthly_fee: 自然数（null 許容、null = 計上しない）
alter table public.children
  drop constraint if exists children_kumon_monthly_fee_range;
alter table public.children
  add constraint children_kumon_monthly_fee_range
  check (kumon_monthly_fee is null or kumon_monthly_fee > 0);

comment on column public.children.municipality is
  '市町村（PDF 利用料金表の「市町村」列）。preschool かつ 名古屋市 のとき無償化対象判定に使用。';
comment on column public.children.copay_tier is
  '利用者上限負担額の階層。zero=0円 / 4600 / 37200 / freeform=自由入力。Phase 66-A';
comment on column public.children.copay_freeform_amount is
  'copay_tier=freeform のときの上限額（円、自然数）。それ以外は null 推奨。';
comment on column public.children.kumon_monthly_fee is
  '公文代（教材印刷代相当）の月額（円、自然数）。null=計上しない。施設・児童ごとに金額を変えられる。Phase 66-A';
