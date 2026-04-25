-- 108: コンテンツに最終編集者(updated_by)を追加
-- お知らせ・遵守事項・研修・業務マニュアルの 4 テーブル全てに追加
-- ON DELETE SET NULL: 編集者が退職しても履歴は残す（NULL になり「編集者」非表示）

DO $$
BEGIN
  -- announcements
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'announcements' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE announcements ADD COLUMN updated_by uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;

  -- compliance_documents
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'compliance_documents' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE compliance_documents ADD COLUMN updated_by uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;

  -- trainings
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trainings' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE trainings ADD COLUMN updated_by uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;

  -- manuals
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'manuals' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE manuals ADD COLUMN updated_by uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;
