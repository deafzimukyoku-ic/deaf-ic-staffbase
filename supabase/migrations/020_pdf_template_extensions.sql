-- 020: document_templates に PDF テンプレート用カラムを追加
-- template_type DEFAULT 'docx' により既存データに影響なし

ALTER TABLE document_templates
  ADD COLUMN pdf_storage_path text,
  ADD COLUMN page_count integer,
  ADD COLUMN template_type text NOT NULL DEFAULT 'docx',
  ADD COLUMN data_mode text NOT NULL DEFAULT 'employee';

-- docx_storage_path を nullable に変更（PDF テンプレートでは不要）
ALTER TABLE document_templates
  ALTER COLUMN docx_storage_path DROP NOT NULL;

-- CHECK制約
ALTER TABLE document_templates
  ADD CONSTRAINT chk_template_type CHECK (template_type IN ('docx', 'pdf')),
  ADD CONSTRAINT chk_data_mode CHECK (data_mode IN ('employee', 'matrix'));
