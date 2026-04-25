-- 106_notification_queue_shift.sql
-- notification_queue に shift_ready / shift_publish タイプを追加
-- シフトは「年月×事業所」単位の通知のため、content_id 概念に合わないので
-- meta jsonb と facility_id カラムを追加して柔軟化する

-- 1. content_type の CHECK 制約を更新
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_content_type_check;
ALTER TABLE notification_queue
  ADD CONSTRAINT notification_queue_content_type_check
  CHECK (content_type IN ('announcement', 'compliance', 'training', 'shift_ready', 'shift_publish'));

-- 2. シフト通知用カラム追加（既存3タイプではNULL）
ALTER TABLE notification_queue
  ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS meta JSONB;

-- 3. content_id を NULL 許容に変更（シフト系は使わない）
ALTER TABLE notification_queue ALTER COLUMN content_id DROP NOT NULL;

-- 4. 既存の (content_type, content_id) UNIQUE は legacy 3 タイプのみに限定
DROP INDEX IF EXISTS uniq_notification_queue_active_content;
CREATE UNIQUE INDEX uniq_notification_queue_active_content
  ON notification_queue (content_type, content_id)
  WHERE sent_at IS NULL
    AND cancelled_at IS NULL
    AND content_type IN ('announcement', 'compliance', 'training');

-- 5. シフト系の重複防止: 同じ (tenant_id, facility_id, year, month, content_type) の未送信は1件まで
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notification_queue_shift_active
  ON notification_queue (tenant_id, facility_id, content_type, ((meta->>'year')::int), ((meta->>'month')::int))
  WHERE sent_at IS NULL
    AND cancelled_at IS NULL
    AND content_type IN ('shift_ready', 'shift_publish');

-- 6. 既存 RLS は role IN ('admin', 'super_admin', 'manager') のまま流用（変更不要）
--    ※ super_admin は deaf-ic で削除済だが既存 RLS との互換のため残置（migration 090 と同方針）
