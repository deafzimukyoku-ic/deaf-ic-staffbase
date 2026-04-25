-- 032: compliance_acknowledgments の外部キーに ON DELETE CASCADE を追加
-- 遵守事項を削除すると関連する確認記録も自動削除される
ALTER TABLE compliance_acknowledgments
  DROP CONSTRAINT IF EXISTS compliance_acknowledgments_compliance_document_id_fkey;

ALTER TABLE compliance_acknowledgments
  ADD CONSTRAINT compliance_acknowledgments_compliance_document_id_fkey
  FOREIGN KEY (compliance_document_id)
  REFERENCES compliance_documents(id)
  ON DELETE CASCADE;
