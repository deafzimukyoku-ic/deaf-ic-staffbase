-- 041: マネージャー管轄判定関数のアップデート

CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  -- マネージャー自身が担当する部署(manager_departments)のいずれかに
  -- 所属している社員(employee_departments)のIDを返す
  SELECT DISTINCT ed.employee_id
  FROM employee_departments ed
  INNER JOIN manager_departments md ON md.department_id = ed.department_id
  WHERE md.employee_id = (
    SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
  )
  AND EXISTS (
    -- テナントの整合性チェック
    SELECT 1 FROM employees e WHERE e.id = ed.employee_id AND e.tenant_id = (
      SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
