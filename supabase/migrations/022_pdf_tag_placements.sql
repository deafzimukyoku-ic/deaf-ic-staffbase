-- 022: PDF テンプレート上のタグ配置座標
-- DocMerge の tag_placements に相当（format_json → font_size のみに簡略化）

CREATE TABLE pdf_tag_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id uuid NOT NULL REFERENCES pdf_tags(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  page_number integer NOT NULL DEFAULT 1,
  x numeric NOT NULL DEFAULT 0,
  y numeric NOT NULL DEFAULT 0,
  font_size integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_tag_placements_template ON pdf_tag_placements(template_id);

CREATE TRIGGER pdf_tag_placements_updated_at
  BEFORE UPDATE ON pdf_tag_placements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
