-- ============================================================
-- migration 121: facilities に業務日報の活動内容/連絡事項テンプレートを追加
--
-- 概要:
--   業務日報の下部「活動内容／連絡事項」枠（AM/PM チェック項目・連絡事項固定文）
--   を施設ごとに設定できるようにする。改行込みのプレーンテキストとして保存し、
--   業務日報レンダリング時に whitespace-pre-line で整形表示。
--
-- 影響:
--   - facilities に daily_report_template text 列を追加
--   - デフォルトは空文字（既存施設は空のまま、必要なら admin/settings で入力）
-- ============================================================

alter table public.facilities
  add column if not exists daily_report_template text not null default '';

comment on column public.facilities.daily_report_template is
  '業務日報の活動内容/連絡事項枠に印字する施設別テンプレート（複数行プレーンテキスト）。';
