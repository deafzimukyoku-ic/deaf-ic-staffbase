-- 046: 所属施設を自動的に管理管轄に含める改善
-- マネージャー自身の所属施設（employees.facility_id）を、manager_facilities への登録なしで管轄に含める

-- 1. 管轄判定関数のアップデート
CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  SELECT DISTINCT e.id
  FROM employees e
  LEFT JOIN manager_facilities mf ON mf.facility_id = e.facility_id
  LEFT JOIN employee_departments ed ON ed.employee_id = e.id
  LEFT JOIN manager_departments md ON md.department_id = ed.department_id
  WHERE (
    -- 1. 本人の所属施設と同じ施設に属する社員
    e.facility_id = (SELECT facility_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    OR 
    -- 2. 担当施設(manager_facilities)に属する社員
    mf.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    OR 
    -- 3. (互換性) 担当部署に属する社員
    md.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  )
  AND e.tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. コンテンツ RLS ポリシーの更新 (本人の所属施設を常に許可対象に含める)

-- announcements
DROP POLICY IF EXISTS manager_manage_announcements ON announcements;
CREATE POLICY manager_manage_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      -- 配信対象施設がマネージャーの「所属施設」または「担当施設」と重なっている
      target_facility_ids && (
        SELECT array_agg(id) FROM (
          SELECT facility_id as id FROM employees WHERE auth_user_id = auth.uid() AND facility_id IS NOT NULL
          UNION
          SELECT facility_id as id FROM manager_facilities WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
        ) as combined_facilities
      )
      OR
      -- (互換性維持) 配信対象部署がマネージャーの担当部署と重なっている
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- compliance_documents
DROP POLICY IF EXISTS manager_manage_compliance ON compliance_documents;
CREATE POLICY manager_manage_compliance ON compliance_documents
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_facility_ids && (
        SELECT array_agg(id) FROM (
          SELECT facility_id as id FROM employees WHERE auth_user_id = auth.uid() AND facility_id IS NOT NULL
          UNION
          SELECT facility_id as id FROM manager_facilities WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
        ) as combined_facilities
      )
      OR
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- trainings
DROP POLICY IF EXISTS manager_manage_trainings ON trainings;
CREATE POLICY manager_manage_trainings ON trainings
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      target_facility_ids && (
        SELECT array_agg(id) FROM (
          SELECT facility_id as id FROM employees WHERE auth_user_id = auth.uid() AND facility_id IS NOT NULL
          UNION
          SELECT facility_id as id FROM manager_facilities WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
        ) as combined_facilities
      )
      OR
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- 8. employee_progress ビューの更新 (施設IDを追加して、マネージャーがフィルタリングしやすくする)
DROP VIEW IF EXISTS employee_progress;
CREATE VIEW employee_progress
WITH (security_invoker = true)
AS
  SELECT
    e.id AS employee_id,
    e.tenant_id,
    e.facility_id,
    (SELECT count(*) FROM document_submissions ds
      WHERE ds.employee_id = e.id AND ds.status = 'submitted') AS docs_submitted,
    (SELECT count(*) FROM compliance_acknowledgments ca
      WHERE ca.employee_id = e.id) AS compliance_done,
    (SELECT count(*) FROM training_submissions ts
      WHERE ts.employee_id = e.id AND ts.result = 'passed') AS trainings_passed,
    (SELECT count(*) FROM announcement_reads ar
      WHERE ar.employee_id = e.id) AS announcements_read
  FROM employees e;
