-- 021: PDF テンプレートのタグ（列）定義
-- DocMerge の tags テーブルに相当

CREATE TABLE pdf_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  column_key varchar(10) NOT NULL,   -- col_A, col_B, ...
  display_name varchar(50) NOT NULL, -- ユーザー表示名
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, column_key),
  UNIQUE (template_id, display_name)
);

CREATE INDEX idx_pdf_tags_template ON pdf_tags(template_id);
