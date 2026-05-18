-- 174: 会社発行用テンプレ識別 + デフォルト発行コメント
--
-- 173 で「会社→社員 書類発行」(issued_documents) を導入したが、
-- 「招待時に決まったテンプレを自動配布したい」「既存社員にも一括配布したい」
-- 「発行モーダルでは配布候補だけ初期表示したい」という運用要望に応えるため、
-- テンプレ側に 2 カラム追加:
--
--   is_company_issued    boolean : true なら IssueDocumentDialog で初期表示 + 招待自動発行 +
--                                  一括発行の対象になる。新規テンプレは既定 OFF (明示的に
--                                  チェックしたものだけ自動配布対象)
--   auto_issue_message   text    : 招待自動発行 / 一括発行時に発行コメントとして自動付与する文言
--                                  (NULL なら message 無しで発行)

ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS is_company_issued boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_issue_message text;

COMMENT ON COLUMN public.document_templates.is_company_issued IS
  '174: 会社が発行する書類 (招待時自動発行 + 一括発行の対象)。テンプレ管理 UI のチェックボックスで切替。';
COMMENT ON COLUMN public.document_templates.auto_issue_message IS
  '174: 招待時自動発行 / 一括発行時に issued_documents.message として記録する固定文言。';

NOTIFY pgrst, 'reload schema';
