/* migration 202 (pg_cron engagement-digest) を pooler 経由で適用 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.resolve(projectRoot, '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) {
  console.error('DATABASE_URL の形式が想定外です:', env.DATABASE_URL);
  process.exit(1);
}
const migrationSql = fs.readFileSync(path.resolve(projectRoot, 'supabase', 'migrations', '202_pg_cron_engagement_digest.sql'), 'utf8');

const client = createPgClient(env);

await client.connect();
try {
  console.log('--- applying migration 202 ---');
  await client.query(migrationSql);
  console.log('--- migration 202 applied ---\n');

  const jobs = await client.query(`
    SELECT jobname, schedule, active FROM cron.job
    WHERE jobname = 'engagement_digest_daily'
  `);
  console.log('--- cron job ---');
  for (const j of jobs.rows) console.log(' ', j.jobname, '|', j.schedule, '| active=', j.active);
} finally {
  await client.end();
}
