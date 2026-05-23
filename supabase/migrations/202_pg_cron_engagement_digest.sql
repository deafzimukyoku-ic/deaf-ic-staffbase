-- 202: push-notifications-v2 用 engagement-digest pg_cron 追加（deaf-ic）

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engagement_digest_daily') THEN
    PERFORM cron.unschedule('engagement_digest_daily');
  END IF;
END $$;

SELECT cron.schedule(
  'engagement_digest_daily',
  '0 9 * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_target_url')
           || '/api/cron/engagement-digest',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 240000
  );
  $job$
);
