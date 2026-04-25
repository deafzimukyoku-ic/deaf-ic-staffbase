-- 044: employees テーブルのスキーマ修復
-- 400 Bad Request (column not found) 対策

DO $$ 
BEGIN
    -- 1. facility_id の確認と追加
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'facility_id') THEN
        ALTER TABLE employees ADD COLUMN facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL;
    END IF;

    -- 2. position_id の確認と追加
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'position_id') THEN
        ALTER TABLE employees ADD COLUMN position_id uuid REFERENCES positions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 既存のインデックスがなければ作成
CREATE INDEX IF NOT EXISTS idx_employees_facility_id ON employees(facility_id);
CREATE INDEX IF NOT EXISTS idx_employees_position_id ON employees(position_id);

-- RLSポリシーの再確認（社員が自分の情報を取得できるように）
-- 既存のポリシーを削除して再作成することで確実に適用する
DROP POLICY IF EXISTS "employee can read self" ON employees;
CREATE POLICY "employee can read self" ON employees
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "employee can update self" ON employees;
CREATE POLICY "employee can update self" ON employees
  FOR UPDATE USING (auth_user_id = auth.uid());
