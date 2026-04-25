-- 023: マトリクス（スプレッドシート）データ行
-- DocMerge の matrix_rows に相当

CREATE TABLE matrix_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  row_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, row_index)
);

CREATE INDEX idx_matrix_rows_template ON matrix_rows(template_id);

CREATE TRIGGER matrix_rows_updated_at
  BEFORE UPDATE ON matrix_rows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
