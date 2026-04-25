-- 119_drop_visibility_condition.sql
--
-- visibility_condition を廃止し、自動判定（lib/field-applicability + lib/document-applicability）に移行。
-- 各書類の必須タグの source_field がどの employee フラグに紐付いているかから動的に該当者を決定する。
--
-- 影響:
--   - document_templates.visibility_condition を drop（'all'/'car_commute_only'/'shuttle_driver_only' は不要）
--   - custom_employee_fields に gate_fields text[] を追加
--     → カスタム項目を employee.has_car_commute 等のフラグに紐付け可能に
--     → null/空 = 全員該当（既存 custom field の挙動互換）

-- ============================================================
-- 1. document_templates.visibility_condition 削除
-- ============================================================

alter table public.document_templates
  drop column if exists visibility_condition;

-- ============================================================
-- 2. custom_employee_fields に gate_fields 追加
-- ============================================================

alter table public.custom_employee_fields
  add column if not exists gate_fields text[] not null default '{}'::text[];

comment on column public.custom_employee_fields.gate_fields is
  'このカスタム項目が該当する社員を限定するフラグ列名の配列（OR セマンティクス）。'
  ' 例: [''has_car_commute''] → has_car_commute=true の社員のみ該当。'
  ' 空 = 全員該当。lib/field-applicability の CORE_FIELD_GATES と同じセマンティクス。';
