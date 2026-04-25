-- 047: コンテンツへの作成者情報追加
-- お知らせ、遵守事項、研修に作成者(created_by)を追加する

-- 1. カラムの追加
DO $$
BEGIN
    -- announcements
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'announcements' AND column_name = 'created_by') THEN
        ALTER TABLE announcements ADD COLUMN created_by uuid REFERENCES employees(id) ON DELETE SET NULL;
    END IF;

    -- compliance_documents
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'compliance_documents' AND column_name = 'created_by') THEN
        ALTER TABLE compliance_documents ADD COLUMN created_by uuid REFERENCES employees(id) ON DELETE SET NULL;
    END IF;

    -- trainings
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trainings' AND column_name = 'created_by') THEN
        ALTER TABLE trainings ADD COLUMN created_by uuid REFERENCES employees(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 2. 既存データへのデフォルト値設定 (必要であれば)
-- 既存のデータは管理者が作成したものとして扱う(任意)

-- 3. RLS ポリシーの微調整 (作成者自身による編集許可など、必要に応じて)
-- 現状のポリシーでマネージャーも自身がターゲットに含まれていれば操作可能だが、
-- 自身が作成したものは常に操作可能にするポリシーを追加しても良い

DROP POLICY IF EXISTS manager_edit_own_announcements ON announcements;
CREATE POLICY manager_edit_own_announcements ON announcements
  FOR ALL
  USING (
    get_my_role() = 'manager' AND created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS manager_edit_own_compliance ON compliance_documents;
CREATE POLICY manager_edit_own_compliance ON compliance_documents
  FOR ALL
  USING (
    get_my_role() = 'manager' AND created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS manager_edit_own_trainings ON trainings;
CREATE POLICY manager_edit_own_trainings ON trainings
  FOR ALL
  USING (
    get_my_role() = 'manager' AND created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );
