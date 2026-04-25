-- 038: 社員と部署・役職の連動強化

-- 1. employees テーブルに position_id を追加
ALTER TABLE employees ADD COLUMN position_id uuid REFERENCES positions(id) ON DELETE SET NULL;
CREATE INDEX idx_employees_position_id ON employees(position_id);

-- 2. 部署（複数選択）用の中間テーブル作成
CREATE TABLE employee_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, department_id)
);

CREATE INDEX idx_employee_depts_employee ON employee_departments(employee_id);
CREATE INDEX idx_employee_depts_department ON employee_departments(department_id);

-- 3. RLS ポリシー
ALTER TABLE employee_departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_depts_tenant_policy ON employee_departments
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_id
      AND e.tenant_id = get_my_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = employee_id
      AND e.tenant_id = get_my_tenant_id()
    )
  );

-- 4. 既存データの移行 (簡易版: 文字列が一致する場合に紐付け)
-- ※ 実際の移行はデータ量や運用に合わせて調整が必要ですが、ここではベースを構築します。
-- UPDATE employees e SET position_id = p.id FROM positions p WHERE e.position = p.name AND e.tenant_id = p.tenant_id;
-- INSERT INTO employee_departments (employee_id, department_id)
-- SELECT e.id, d.id FROM employees e JOIN departments d ON e.department = d.name WHERE e.tenant_id = d.tenant_id;
