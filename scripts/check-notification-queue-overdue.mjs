/* migration 180 適用前の現状調査。
   notification_queue の現状を以下の観点でカウントし、24h overdue な未送信件数を確認する。
   想定外に多ければユーザーに報告。
   - 全件 / pending / sent / cancelled
   - pending のうち scheduled_at < now() (即時送信対象)
   - pending のうち scheduled_at < now() - 24h (今回 cancel 予定)
   - 直近 30 日の sent_at 分布 (cron が走っていなかった期間の特定) */
import { createPgClient, loadEnv } from './_db.mjs';

const env = loadEnv();
const client = createPgClient(env);

await client.connect();
try {
  const summary = await client.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL) AS pending,
      COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
      COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled,
      COUNT(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL AND scheduled_at < now()) AS pending_overdue,
      COUNT(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL AND scheduled_at < now() - interval '24 hours') AS pending_overdue_24h,
      COUNT(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL AND scheduled_at < now() - interval '7 days') AS pending_overdue_7d
    FROM public.notification_queue;
  `);
  console.log('--- notification_queue summary ---');
  console.log(summary.rows[0]);

  const old = await client.query(`
    SELECT id, content_type, content_id, scheduled_at, created_at, tenant_id
    FROM public.notification_queue
    WHERE sent_at IS NULL
      AND cancelled_at IS NULL
      AND scheduled_at < now() - interval '24 hours'
    ORDER BY scheduled_at
    LIMIT 30;
  `);
  console.log('\n--- pending > 24h overdue (preview, max 30) ---');
  if (old.rowCount === 0) {
    console.log('  none');
  } else {
    for (const r of old.rows) {
      console.log('  ', r.scheduled_at.toISOString(), '|', r.content_type, '|', r.id.slice(0, 8), '|', 'created:', r.created_at.toISOString());
    }
  }

  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notification_queue'
    ORDER BY ordinal_position;
  `);
  console.log('\n--- notification_queue columns ---');
  for (const c of cols.rows) console.log('  ', c.column_name, c.data_type, 'nullable=', c.is_nullable);

  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='notification_queue';
  `);
  console.log('\n--- notification_queue indexes ---');
  for (const i of idx.rows) console.log('  ', i.indexname);

  const recentSent = await client.query(`
    SELECT date_trunc('day', sent_at) AS day, COUNT(*) AS sent_rows
    FROM public.notification_queue
    WHERE sent_at IS NOT NULL
      AND sent_at >= now() - interval '30 days'
    GROUP BY 1 ORDER BY 1 DESC;
  `);
  console.log('\n--- sent rows per day (last 30 days) ---');
  for (const r of recentSent.rows) console.log('  ', r.day.toISOString().slice(0,10), 'sent=', r.sent_rows);

  /* cron 経路の存在確認 (pg_cron / pg_net) */
  const ext = await client.query(`
    SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net') ORDER BY extname;
  `);
  console.log('\n--- extensions ---');
  for (const e of ext.rows) console.log('  ', e.extname, 'installed');
  if (ext.rows.length < 2) {
    const missing = ['pg_cron', 'pg_net'].filter(x => !ext.rows.find(r => r.extname === x));
    console.log('  missing:', missing.join(', '));
  }

  const jobs = await client.query(`
    SELECT jobid, schedule, command, jobname, active
    FROM cron.job
    WHERE jobname LIKE '%notification%' OR jobname LIKE '%dispatch%'
    ORDER BY jobid;
  `).catch((e) => ({ rows: [], err: e.message }));
  console.log('\n--- existing notification cron jobs ---');
  if (jobs.err) console.log('  (cron schema not accessible:', jobs.err, ')');
  else if (jobs.rows.length === 0) console.log('  none');
  else for (const j of jobs.rows) console.log('  ', j.jobname, '|', j.schedule, '|', 'active=', j.active);
} finally {
  await client.end();
}
