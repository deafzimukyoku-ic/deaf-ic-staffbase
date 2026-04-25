-- 042: 配信ターゲットの拡張 (部署・役職)

-- announcements
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_department_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_position_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_announcements_target_department_ids
  ON announcements USING GIN (target_department_ids);
CREATE INDEX IF NOT EXISTS idx_announcements_target_position_ids
  ON announcements USING GIN (target_position_ids);

-- compliance_documents
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS target_department_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_position_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_compliance_documents_target_department_ids
  ON compliance_documents USING GIN (target_department_ids);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_target_position_ids
  ON compliance_documents USING GIN (target_position_ids);

-- trainings
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS target_department_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_position_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_trainings_target_department_ids
  ON trainings USING GIN (target_department_ids);
CREATE INDEX IF NOT EXISTS idx_trainings_target_position_ids
  ON trainings USING GIN (target_position_ids);
