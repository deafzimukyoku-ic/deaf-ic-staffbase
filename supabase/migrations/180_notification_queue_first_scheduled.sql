-- 180: notification_queue に first_scheduled_at を追加し
-- 「最初の投稿から強制送信までの上限 (MAX_DELAY_HOURS)」管理を可能にする。
--
-- 背景:
--   enqueue/route.ts (旧) は投稿ごとに独立 scheduled_at (created_at + 2h) を
--   設定し、同テナント他 pending 行を再スケジュールしなかった。cron が 30 分毎
--   に走ると、別時刻に投稿された行はそれぞれ別の cron tick で拾われて 1 通ずつ
--   送られていた (2h 集約が機能していない)。
--
-- 設計:
--   新規投稿時に同テナントの全 pending 行を最新の (now + DELAY_HOURS) に揃える
--   (rolling window)。ただし最初の投稿から MAX_DELAY_HOURS=6 経過したら強制送信
--   する hardCap が必要。そのために「最初の投稿時刻」を保持する first_scheduled_at
--   カラムを追加する (rolling 揃え替えでは触らない)。
--
-- 既存データ:
--   - 24h 以上 overdue な pending 行はゴミなので cancel して破棄
--     (ユーザー承認済 2026-05-18: 24h overdue 0 件であることを事前 SQL で確認済)
--   - それ以外の pending 行は first_scheduled_at = scheduled_at で backfill
--     (粗いが旧仕様の挙動を保つ)

BEGIN;

-- (1) カラム追加 + backfill + NOT NULL 化
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS first_scheduled_at timestamptz;

UPDATE public.notification_queue
  SET first_scheduled_at = scheduled_at
  WHERE first_scheduled_at IS NULL;

ALTER TABLE public.notification_queue
  ALTER COLUMN first_scheduled_at SET NOT NULL;

COMMENT ON COLUMN public.notification_queue.first_scheduled_at IS
  '180: 最初の投稿から強制送信までの上限管理用。新規投稿時に同テナントの未送信行を rolling window で scheduled_at 揃え替えするが first_scheduled_at は触らないことで MAX_DELAY_HOURS の起点を保持する';

-- (2) 24h 以上 overdue な未送信を破棄 (ユーザー承認済、事前確認で 0 件)
UPDATE public.notification_queue
  SET cancelled_at = now()
  WHERE sent_at IS NULL
    AND cancelled_at IS NULL
    AND scheduled_at < now() - interval '24 hours';

-- (3) 新規 enqueue のローリングウィンドウ UPDATE と cron 抽出を最適化する部分 INDEX。
--     既存 idx_notification_queue_ready は (scheduled_at) のみだが、enqueue 側は
--     tenant_id でフィルタするため複合 INDEX のほうが効く
CREATE INDEX IF NOT EXISTS idx_notif_queue_pending_scheduled
  ON public.notification_queue (tenant_id, scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
