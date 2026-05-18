-- 181: GitHub Actions schedule の discard 多発に対し、Supabase pg_cron + pg_net で
-- 10 分毎に Vercel エンドポイントを叩く方式へ移行。
-- Vercel Hobby プランの「cron 1 日 1 回」制約を Supabase 側から回避する。
--
-- 背景:
--   .github/workflows/notification-cron.yml は GitHub Actions schedule で
--   30 分毎に /api/cron/send-notifications を叩いていたが、GH Actions schedule
--   は公式 best-effort 仕様 (SLA 無し) で discard が多発し、長期間停止していた:
--     - 2026-04-24 作成 12 件が 5/15 まで 21 日放置
--     - 5/18 3 件が 1h44m 遅延 / 5/16 1 件が 3h14m 遅延
--   30 分間隔に下げても解消せず、Supabase 内完結方式へ移行する。
--
-- 前提:
--   * Supabase Vault に手動で secret を 2 つ登録済 (Project Settings > Vault):
--       - cron_target_url : https://www.deaf-ic-nagoya.org (末尾スラッシュ無し)
--       - cron_secret     : Vercel env の CRON_SECRET と同値
--   * /api/cron/send-notifications は Authorization: Bearer ${CRON_SECRET} を検証
--   * route handler は冪等 (sent_at が立つと再送しない) なので、Vault 未登録時の
--     NULL POST も実害無し (Vault 登録後に自然復旧)
--
-- pg_cron / pg_net は Supabase Free プランでも利用可能。

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 既存ジョブがあれば一旦除去 (べき等)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch_notification_queue') THEN
    PERFORM cron.unschedule('dispatch_notification_queue');
  END IF;
END $$;

-- 10 分毎に Vercel エンドポイントを叩く。timeout 240s は GitHub Actions workflow の
-- curl --max-time 240 と合わせる (send-notifications/route.ts 側の処理上限と整合)
SELECT cron.schedule(
  'dispatch_notification_queue',
  '*/10 * * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_target_url')
           || '/api/cron/send-notifications',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 240000
  );
  $job$
);

COMMENT ON EXTENSION pg_cron IS '181: notification_queue dispatch every 10 min via pg_net';
