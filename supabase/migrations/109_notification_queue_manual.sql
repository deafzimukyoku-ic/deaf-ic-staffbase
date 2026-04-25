-- 109_notification_queue_manual.sql
-- migration 037 で content_type CHECK に 'manual' が含まれていなかったため追加。
-- migration 091 で manuals 機能を追加した時に notification_queue 制約への追従が漏れていた。
-- これにより業務マニュアルの作成・編集時の通知メール enqueue が CHECK 制約違反で失敗していた。

-- 1. CHECK 制約を再構築（既存の shift 系 + manual）
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_content_type_check;
ALTER TABLE notification_queue
  ADD CONSTRAINT notification_queue_content_type_check
  CHECK (content_type IN ('announcement', 'compliance', 'training', 'manual', 'shift_ready', 'shift_publish'));

-- 2. legacy 系 UNIQUE インデックス（編集時にタイマーリセットするため content_id ベース）
--    manual を含めて再作成
DROP INDEX IF EXISTS uniq_notification_queue_active_content;
CREATE UNIQUE INDEX uniq_notification_queue_active_content
  ON notification_queue (content_type, content_id)
  WHERE sent_at IS NULL
    AND cancelled_at IS NULL
    AND content_type IN ('announcement', 'compliance', 'training', 'manual');
