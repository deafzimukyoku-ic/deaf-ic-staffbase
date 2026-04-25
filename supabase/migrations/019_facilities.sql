-- 事業所（施設）テーブル
CREATE TABLE facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_facilities_tenant ON facilities(tenant_id);

-- RLS
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage facilities" ON facilities
  FOR ALL USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() IN ('admin', 'super_admin')
  );

CREATE POLICY "employee can read facilities" ON facilities
  FOR SELECT USING (tenant_id = get_my_tenant_id());

-- employeesにfacility_id追加
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL;
