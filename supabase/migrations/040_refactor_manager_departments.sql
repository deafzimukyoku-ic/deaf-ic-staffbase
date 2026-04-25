-- 040: manager_departments の部署ID移行

-- 1. カラム追加
ALTER TABLE manager_departments ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE CASCADE;

-- 2. 既存データの移行（テキストが一致するものを紐付け）
UPDATE manager_departments md
SET department_id = d.id
FROM departments d
WHERE md.department = d.name AND d.tenant_id = (
  SELECT tenant_id FROM employees WHERE id = md.employee_id
);

-- 3. 制約の追加（移行後に NULL を許容しない場合）
-- ALTER TABLE manager_departments ALTER COLUMN department_id SET NOT NULL;

-- 4. 古いカラムの削除（必要に応じて。一旦安全のため残す場合はコメントアウト）
-- ALTER TABLE manager_departments DROP COLUMN department;

-- 5. RLS や関数で使用されるため、IDベースのユニーク制約を追加
ALTER TABLE manager_departments ADD CONSTRAINT unique_mgr_dept_id UNIQUE (employee_id, department_id);
