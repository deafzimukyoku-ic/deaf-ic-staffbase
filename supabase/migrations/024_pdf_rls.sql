-- 024: PDF関連テーブルの RLS ポリシー
-- テナント所有権を document_templates 経由で検証

-- pdf_tags
ALTER TABLE pdf_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdf_tags_tenant_policy ON pdf_tags
  USING (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tags.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tags.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  );

-- pdf_tag_placements
ALTER TABLE pdf_tag_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdf_tag_placements_tenant_policy ON pdf_tag_placements
  USING (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tag_placements.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = pdf_tag_placements.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  );

-- matrix_rows
ALTER TABLE matrix_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY matrix_rows_tenant_policy ON matrix_rows
  USING (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = matrix_rows.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM document_templates dt
      WHERE dt.id = matrix_rows.template_id
        AND dt.tenant_id = get_my_tenant_id()
    )
  );
