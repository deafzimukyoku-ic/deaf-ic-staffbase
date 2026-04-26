-- ============================================================
-- migration 120: custom_employee_fields にセクション割当を追加
--
-- 概要:
--   カスタム項目を社員プロフィールのどのタブに表示するかを選択可能にする。
--   従来は基本タブ末尾に固定表示だったが、通勤・連絡先タブにも振り分けられるように。
--
-- 影響:
--   - custom_employee_fields に section text 列を追加
--   - 値: 'basic' | 'commute' | 'contacts'（CHECK 制約）
--   - デフォルト 'basic'（既存データは互換維持）
-- ============================================================

alter table public.custom_employee_fields
  add column if not exists section text not null default 'basic'
    check (section in ('basic', 'commute', 'contacts'));

comment on column public.custom_employee_fields.section is
  'カスタム項目を表示するプロフィールセクション。basic（基本）/ commute（通勤）/ contacts（連絡先）のいずれか。';
