-- 016: マネージャーロール用 RLS ポリシー

-- ============ manager_departments ============
ALTER TABLE manager_departments ENABLE ROW LEVEL SECURITY;

-- admin/super_admin が管理（作成・編集・削除）
CREATE POLICY "admin can manage manager_departments"
  ON manager_departments FOR ALL
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE tenant_id = get_my_tenant_id()
    )
    AND get_my_role() IN ('admin', 'super_admin')
  );

-- マネージャー本人は自分の担当部署を読取のみ
CREATE POLICY "manager can read own departments"
  ON manager_departments FOR SELECT
  USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

-- ============ employees: マネージャーが部下を閲覧 ============
CREATE POLICY "manager can read subordinates"
  ON employees FOR SELECT
  USING (
    get_my_role() = 'manager'
    AND id IN (SELECT get_manager_subordinate_ids())
  );

-- ============ trainings: マネージャーが作成・編集可能 ============
CREATE POLICY "manager can insert trainings"
  ON trainings FOR INSERT
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );

CREATE POLICY "manager can update trainings"
  ON trainings FOR UPDATE
  USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );

-- ============ training_submissions: マネージャーが部下の提出を管理 ============
CREATE POLICY "manager can manage subordinate training subs"
  ON training_submissions FOR ALL
  USING (
    get_my_role() = 'manager'
    AND employee_id IN (SELECT get_manager_subordinate_ids())
  );
