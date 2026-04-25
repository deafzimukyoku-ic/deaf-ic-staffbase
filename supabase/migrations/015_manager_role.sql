-- 015: マネージャーロール用テーブル
-- マネージャーが担当する部署の中間テーブル
-- adminが「この社員(manager)はこの部署を担当」と複数指定可能

CREATE TABLE manager_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department text NOT NULL,
  UNIQUE(employee_id, department)
);

CREATE INDEX idx_manager_depts_employee ON manager_departments(employee_id);
CREATE INDEX idx_manager_depts_department ON manager_departments(department);

-- マネージャーの担当部署に所属する社員を返すヘルパー関数
CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  SELECT e.id
  FROM employees e
  INNER JOIN manager_departments md
    ON md.department = e.department
  WHERE md.employee_id = (
    SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
  )
  AND e.tenant_id = (
    SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;
