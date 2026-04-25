-- 111_view_logs.sql
-- 何回見たか / いつ見たか の記録用テーブル4種
-- employee が詳細モーダルを開くたびに INSERT される（append-only）

CREATE TABLE compliance_view_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES compliance_documents(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_compliance_view_logs_emp_item ON compliance_view_logs(employee_id, item_id);
CREATE INDEX idx_compliance_view_logs_tenant ON compliance_view_logs(tenant_id);

CREATE TABLE training_view_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_training_view_logs_emp_item ON training_view_logs(employee_id, item_id);
CREATE INDEX idx_training_view_logs_tenant ON training_view_logs(tenant_id);

CREATE TABLE announcement_view_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_announcement_view_logs_emp_item ON announcement_view_logs(employee_id, item_id);
CREATE INDEX idx_announcement_view_logs_tenant ON announcement_view_logs(tenant_id);

CREATE TABLE manual_view_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_manual_view_logs_emp_item ON manual_view_logs(employee_id, item_id);
CREATE INDEX idx_manual_view_logs_tenant ON manual_view_logs(tenant_id);

ALTER TABLE compliance_view_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_view_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_view_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_view_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY emp_insert_self ON compliance_view_logs FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
CREATE POLICY emp_insert_self ON training_view_logs FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
CREATE POLICY emp_insert_self ON announcement_view_logs FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
CREATE POLICY emp_insert_self ON manual_view_logs FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY admin_mgr_select ON compliance_view_logs FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid())
         AND (SELECT role FROM employees WHERE auth_user_id = auth.uid()) IN ('admin','manager'));
CREATE POLICY admin_mgr_select ON training_view_logs FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid())
         AND (SELECT role FROM employees WHERE auth_user_id = auth.uid()) IN ('admin','manager'));
CREATE POLICY admin_mgr_select ON announcement_view_logs FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid())
         AND (SELECT role FROM employees WHERE auth_user_id = auth.uid()) IN ('admin','manager'));
CREATE POLICY admin_mgr_select ON manual_view_logs FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid())
         AND (SELECT role FROM employees WHERE auth_user_id = auth.uid()) IN ('admin','manager'));

CREATE POLICY emp_select_self ON compliance_view_logs FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
CREATE POLICY emp_select_self ON training_view_logs FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
CREATE POLICY emp_select_self ON announcement_view_logs FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
CREATE POLICY emp_select_self ON manual_view_logs FOR SELECT TO authenticated
  USING (employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
