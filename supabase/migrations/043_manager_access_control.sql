-- 043: マネージャー向けのアクセス制御 (RLS) - 最終標準化版

-- 1. カラム名の揺れを検知して標準化 (Sの有無などを統一)
DO $$
BEGIN
    -- employee_departments の標準化
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_departments' AND column_name = 'departments_id') THEN
        ALTER TABLE employee_departments RENAME COLUMN departments_id TO department_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_departments' AND column_name = 'display_order') THEN
        ALTER TABLE employee_departments ADD COLUMN display_order int DEFAULT 0;
    END IF;

    -- manager_departments のリネーム (departments_id -> department_id)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manager_departments' AND column_name = 'departments_id') THEN
        ALTER TABLE manager_departments RENAME COLUMN departments_id TO department_id;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'manager_departments' AND column_name = 'department_id') THEN
        ALTER TABLE manager_departments ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE CASCADE;
        UPDATE manager_departments md SET department_id = d.id FROM departments d 
        WHERE md.department = d.name AND d.tenant_id = (SELECT tenant_id FROM employees WHERE id = md.employee_id);
    END IF;

    -- 各コンテンツテーブルの標準化 (target_departments_id / target_department_id -> target_department_ids)
    -- announcements
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'target_departments_id') THEN
        ALTER TABLE announcements RENAME COLUMN target_departments_id TO target_department_ids;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'target_department_id') THEN
        ALTER TABLE announcements RENAME COLUMN target_department_id TO target_department_ids;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'target_department_ids') THEN
        ALTER TABLE announcements ADD COLUMN target_department_ids uuid[] DEFAULT '{}';
    END IF;

    -- compliance_documents
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'target_departments_id') THEN
        ALTER TABLE compliance_documents RENAME COLUMN target_departments_id TO target_department_ids;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'target_department_id') THEN
        ALTER TABLE compliance_documents RENAME COLUMN target_department_id TO target_department_ids;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'target_department_ids') THEN
        ALTER TABLE compliance_documents ADD COLUMN target_department_ids uuid[] DEFAULT '{}';
    END IF;

    -- trainings
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'target_departments_id') THEN
        ALTER TABLE trainings RENAME COLUMN target_departments_id TO target_department_ids;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'target_department_id') THEN
        ALTER TABLE trainings RENAME COLUMN target_department_id TO target_department_ids;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'target_department_ids') THEN
        ALTER TABLE trainings ADD COLUMN target_department_ids uuid[] DEFAULT '{}';
    END IF;
END $$;

-- 2. announcements
DROP POLICY IF EXISTS manager_manage_announcements ON announcements;
CREATE POLICY manager_manage_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_department_ids && (
        SELECT array_agg(department_id) 
        FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 3. compliance_documents
DROP POLICY IF EXISTS manager_manage_compliance ON compliance_documents;
CREATE POLICY manager_manage_compliance ON compliance_documents
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_department_ids && (
        SELECT array_agg(department_id) 
        FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 4. trainings
DROP POLICY IF EXISTS manager_manage_trainings ON trainings;
CREATE POLICY manager_manage_trainings ON trainings
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_department_ids && (
        SELECT array_agg(department_id) 
        FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 5. employees
DROP POLICY IF EXISTS manager_manage_subordinates ON employees;
CREATE POLICY manager_manage_subordinates ON employees
  FOR ALL
  USING (
    get_my_role() = 'manager' AND id IN (SELECT get_manager_subordinate_ids())
  );

-- 6. employee_departments (RLS の再構築 - テナントベース)
DROP POLICY IF EXISTS employee_depts_tenant_policy ON employee_departments;
DROP POLICY IF EXISTS admin_manage_employee_depts ON employee_departments;
DROP POLICY IF EXISTS manager_manage_subordinate_depts ON employee_departments;

CREATE POLICY employee_depts_tenant_access ON employee_departments
  FOR ALL
  TO authenticated
  USING (
    department_id IN (
      SELECT id FROM departments WHERE tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  )
  WITH CHECK (
    department_id IN (
      SELECT id FROM departments WHERE tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );
