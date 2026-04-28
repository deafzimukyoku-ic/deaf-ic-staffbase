-- 125_facility_shift_only_mode.sql
-- 事業所単位「シフトのみモード」フラグ
-- ON にすると sidebar から 利用表 / 送迎表 / 日次出力 / 業務日報 / 事業所設定 / 児童管理 が消え、
-- ダッシュボード + シフト表 + 休み希望 + 職員管理 の 4 項目のみ表示される。
-- 既存の shift_enabled / transport_enabled とは独立した別軸のフラグ。

alter table public.facilities
  add column if not exists shift_only_mode boolean not null default false;

comment on column public.facilities.shift_only_mode is
  'シフトのみモード。true ならシフト表 / 休み希望 / 職員管理 / ダッシュボードのみ表示し、利用表 / 送迎表 / 日次出力 / 業務日報 / 事業所設定 / 児童管理 を sidebar から除外。';
