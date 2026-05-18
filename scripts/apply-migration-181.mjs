/* migration 181 (pg_cron + pg_net + dispatch_notification_queue) を pooler 経由で適用。
   前提: Vault に cron_target_url / cron_secret 登録済 + Vercel CRON_SECRET 同期済。
   適用後に cron.job / 直近 cron.job_run_details を表示して動作確認の起点にする */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '..', '..', '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const password = decodeURIComponent(m[2]);
const ref = m[3];
const migrationSql = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'migrations', '181_pg_cron_notification_dispatch.sql'), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${ref}`,
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  /* 事前確認 */
  const ext = await client.query(`SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net') ORDER BY extname`);
  console.log('[BEFORE] extensions installed:', ext.rows.map(r => r.extname).join(', ') || '(none)');

  console.log('\n--- applying migration 181 ---');
  await client.query(migrationSql);
  console.log('--- migration 181 applied ---\n');

  const ext2 = await client.query(`SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net') ORDER BY extname`);
  console.log('[AFTER] extensions installed:', ext2.rows.map(r => r.extname).join(', '));

  const jobs = await client.query(`SELECT jobid, schedule, jobname, active FROM cron.job WHERE jobname='dispatch_notification_queue'`);
  console.log('\n--- cron.job ---');
  for (const j of jobs.rows) console.log('  jobid:', j.jobid, '| schedule:', j.schedule, '| jobname:', j.jobname, '| active:', j.active);

  /* 直近の実行履歴 (migration 直後はまだ走ってない可能性大) */
  const runs = await client.query(`
    SELECT jobid, status, return_message, start_time, end_time
    FROM cron.job_run_details
    WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='dispatch_notification_queue')
    ORDER BY start_time DESC LIMIT 5
  `).catch((e) => ({ err: e.message, rows: [] }));
  console.log('\n--- recent job_run_details (last 5) ---');
  if (runs.err) console.log('  (read error:', runs.err, ')');
  else if (runs.rows.length === 0) console.log('  none yet (10 分後に再確認)');
  else for (const r of runs.rows) console.log('  ', r.start_time.toISOString(), '|', r.status, '|', r.return_message?.slice(0, 80));
} finally {
  await client.end();
}
