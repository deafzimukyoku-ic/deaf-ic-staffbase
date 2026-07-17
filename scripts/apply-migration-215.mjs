/* migration 215 を pooler 経由で適用。first_scheduled_at の DEFAULT を before/after 検証。
   さらに shift_publish の dry-run INSERT (ROLLBACK) で「first_scheduled_at を省略しても
   INSERT が通る」ことを確認する（真因の再発防止が効いているかの実証）。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '215_notification_queue_first_scheduled_default.sql'), 'utf8');

const client = createPgClient(env);

async function showDefault(label) {
  const r = await client.query(`
    SELECT column_default, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notification_queue' AND column_name='first_scheduled_at'`);
  console.log(`[${label}] first_scheduled_at:`, r.rows[0]);
}

async function dryRunInsert(label) {
  try {
    await client.query('BEGIN');
    const t = await client.query(`select id from tenants limit 1`);
    const f = await client.query(`select id from facilities limit 1`);
    await client.query(
      `insert into notification_queue (tenant_id, facility_id, content_type, content_id, meta, scheduled_at)
       values ($1,$2,'shift_publish',null,'{"year":2026,"month":6}'::jsonb, now())`,
      [t.rows[0].id, f.rows[0].id]);
    console.log(`  [${label}] first_scheduled_at 省略 INSERT → 成功 (再発防止 OK)`);
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(`  [${label}] first_scheduled_at 省略 INSERT → 失敗: ${err.message}`);
  }
}

await client.connect();
try {
  await showDefault('BEFORE');
  await dryRunInsert('BEFORE');
  console.log('\n--- applying migration 215 ---');
  await client.query(migrationSql);
  console.log('--- migration 215 applied ---\n');
  await showDefault('AFTER');
  await dryRunInsert('AFTER');
} finally {
  await client.end();
}
