-- deaf-ic: 業務マニュアル機能追加
-- Phase 1.5: manuals + manual_reads + categories.type='manual'

-- 1. categories.type に 'manual' を追加
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_type_check;
ALTER TABLE categories
  ADD CONSTRAINT categories_type_check
  CHECK (type IN ('compliance', 'training', 'announcement', 'manual'));

-- 2. manuals テーブル
CREATE TABLE manuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  pdf_storage_path text,
  category_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
  target_type text NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'facility')),
  target_facility_ids uuid[] NOT NULL DEFAULT '{}',
  target_department_ids uuid[] NOT NULL DEFAULT '{}',
  target_position_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_manuals_tenant ON manuals(tenant_id);
CREATE INDEX idx_manuals_category ON manuals(category_id);
CREATE INDEX idx_manuals_target_facility_ids ON manuals USING GIN(target_facility_ids);
CREATE INDEX idx_manuals_target_department_ids ON manuals USING GIN(target_department_ids);
CREATE INDEX idx_manuals_target_position_ids ON manuals USING GIN(target_position_ids);

-- 3. manual_reads テーブル（既読トラッキング）
CREATE TABLE manual_reads (
  manual_id uuid NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manual_id, employee_id)
);

-- 4. RLS
ALTER TABLE manuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can read manuals"
  ON manuals FOR SELECT
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "admin can manage manuals"
  ON manuals FOR ALL
  USING (tenant_id = get_my_tenant_id() AND get_my_role() = 'admin');

CREATE POLICY "manager can manage manuals in own depts"
  ON manuals FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_department_ids && (
        SELECT COALESCE(array_agg(department_id), '{}'::uuid[])
        FROM manager_departments
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

CREATE POLICY "employee can manage own manual reads"
  ON manual_reads FOR ALL
  USING (employee_id IN (SELECT id FROM get_my_employee()));

CREATE POLICY "admin can read tenant manual reads"
  ON manual_reads FOR SELECT
  USING (
    employee_id IN (SELECT id FROM employees WHERE tenant_id = get_my_tenant_id())
    AND get_my_role() = 'admin'
  );
