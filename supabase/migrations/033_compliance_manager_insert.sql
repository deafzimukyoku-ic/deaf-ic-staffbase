-- 033: マネージャーに遵守事項の追加のみ許可
CREATE POLICY "manager can insert compliance"
  ON compliance_documents
  FOR INSERT
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );
