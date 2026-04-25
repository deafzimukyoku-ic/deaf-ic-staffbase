-- 028: カスタム入力項目マスター
CREATE TABLE custom_employee_fields (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb DEFAULT '[]'::jsonb,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, field_key),
  CONSTRAINT valid_field_type CHECK (field_type IN ('text', 'date', 'number', 'select', 'image'))
);

CREATE INDEX idx_custom_employee_fields_tenant ON custom_employee_fields(tenant_id);

ALTER TABLE custom_employee_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_employee_fields_tenant_policy ON custom_employee_fields
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());
