-- 025: compliance_documents に created_at カラムを追加
-- ページ側で order('created_at') を使用しているが、005_compliance.sql に定義漏れ
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
