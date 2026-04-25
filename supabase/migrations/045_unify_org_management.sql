-- 045: マネージャーの管轄とコンテンツ配信を「施設（事業所）」ベースに移行

-- 1. manager_facilities テーブルの作成
-- マネージャー（employee_id）と担当施設（facility_id）を紐付ける
CREATE TABLE IF NOT EXISTS manager_facilities (
    employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
    facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (employee_id, facility_id)
);

-- RLS を有効化（テナントベース）
ALTER TABLE manager_facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY manager_facilities_tenant_access ON manager_facilities
  FOR ALL
  TO authenticated
  USING (
    facility_id IN (
      SELECT id FROM facilities WHERE tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );

-- 2. 既存データからの移行 (名前ベースのマッチング)
-- マネージャーが「部署」を担当している場合、同じ名前の「施設」にも自動的に紐付ける
INSERT INTO manager_facilities (employee_id, facility_id)
SELECT DISTINCT md.employee_id, f.id
FROM manager_departments md
JOIN departments d ON d.id = md.department_id
JOIN facilities f ON f.name = d.name AND f.tenant_id = d.tenant_id
ON CONFLICT (employee_id, facility_id) DO NOTHING;

-- 3. マネージャー管轄判定関数のアップデート (施設ベース)
-- get_manager_subordinate_ids を再定義
CREATE OR REPLACE FUNCTION get_manager_subordinate_ids()
RETURNS SETOF uuid AS $$
  -- マネージャー自身が担当する施設(manager_facilities)に
  -- 直属所属(facility_id)している社員、
  -- または旧来の「部署」ベースで紐付いている社員を合算して返す
  -- ※移行期間中につき両方サポート
  SELECT DISTINCT e.id
  FROM employees e
  LEFT JOIN manager_facilities mf ON mf.facility_id = e.facility_id
  LEFT JOIN employee_departments ed ON ed.employee_id = e.id
  LEFT JOIN manager_departments md ON md.department_id = ed.department_id
  WHERE (mf.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
         OR md.employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1))
  AND e.tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. コンテンツテーブルの RLS ポリシー更新 (施設ベース管理者のサポート)

-- announcements
DROP POLICY IF EXISTS manager_manage_announcements ON announcements;
CREATE POLICY manager_manage_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND (
      -- 配信対象施設がマネージャーの担当施設と重なっている
      target_facility_ids && (
        SELECT array_agg(facility_id) FROM manager_facilities 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
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
        SELECT array_agg(facility_id) FROM manager_facilities 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
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
        SELECT array_agg(facility_id) FROM manager_facilities 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
      OR
      target_department_ids && (
        SELECT array_agg(department_id) FROM manager_departments 
        WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
      )
    )
  );
