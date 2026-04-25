-- 036_facility_scope.sql
-- announcements / compliance_documents / trainings に「対象スコープ」カラム追加
-- target_type='all' (全社員) または 'facility' (特定施設)
-- target_facility_ids は target_type='facility' のとき複数施設ID配列
-- 既存レコードは DEFAULT 'all' で全社員配信扱いにフォールバック
--
-- 冪等化: 手動で一部を既に実行済みでも再実行可能

-- announcements
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_facility_ids UUID[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_target_type_check') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_target_type_check CHECK (target_type IN ('all', 'facility'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_announcements_target_facility_ids
  ON announcements USING GIN (target_facility_ids);

-- compliance_documents
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS target_facility_ids UUID[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compliance_documents_target_type_check') THEN
    ALTER TABLE compliance_documents ADD CONSTRAINT compliance_documents_target_type_check CHECK (target_type IN ('all', 'facility'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_compliance_documents_target_facility_ids
  ON compliance_documents USING GIN (target_facility_ids);

-- trainings
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS target_facility_ids UUID[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trainings_target_type_check') THEN
    ALTER TABLE trainings ADD CONSTRAINT trainings_target_type_check CHECK (target_type IN ('all', 'facility'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_trainings_target_facility_ids
  ON trainings USING GIN (target_facility_ids);
