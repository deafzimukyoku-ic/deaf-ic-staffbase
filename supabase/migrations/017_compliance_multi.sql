-- 遵守事項を複数件対応にする
-- titleカラム追加（各遵守事項を区別）
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';

-- 編集時に再確認を要求するためのバージョンカラム
-- updated_atが更新されたらacknowledgmentを無効化する仕組み
ALTER TABLE compliance_acknowledgments
  ADD COLUMN IF NOT EXISTS document_updated_at timestamptz;

-- 既存のUNIQUE制約を削除し、updated_at付きで再作成
-- これにより同じ社員が同じ文書の新バージョンを再確認できる
ALTER TABLE compliance_acknowledgments
  DROP CONSTRAINT IF EXISTS compliance_acknowledgments_employee_id_compliance_document__key;

-- 社員×文書×バージョンでユニーク
ALTER TABLE compliance_acknowledgments
  ADD CONSTRAINT compliance_ack_emp_doc_version_key
  UNIQUE (employee_id, compliance_document_id, document_updated_at);
