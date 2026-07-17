/* migration 201 (push_notifications_v2 基盤) を pooler 経由で適用 */
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
const migrationSql = fs.readFileSync(path.resolve(projectRoot, 'supabase', 'migrations', '201_push_notifications_v2.sql'), 'utf8');

const client = createPgClient(env);

await client.connect();
try {
  console.log('[BEFORE] checking notification_log existence...');
  const before = await client.query(`SELECT to_regclass('public.notification_log') AS exists_as`);
  console.log('  ->', before.rows[0].exists_as ?? '(not yet)');

  console.log('\n--- applying migration 201 ---');
  await client.query(migrationSql);
  console.log('--- migration 201 applied ---\n');

  const after = await client.query(`SELECT to_regclass('public.notification_log') AS exists_as`);
  console.log('[AFTER] notification_log:', after.rows[0].exists_as);

  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_log'
    ORDER BY ordinal_position
  `);
  console.log('\n--- notification_log columns ---');
  for (const c of cols.rows) console.log(' ', c.column_name, '|', c.data_type);

  const chk = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'notification_queue'
      AND c.conname = 'notification_queue_content_type_check'
  `);
  console.log('\n--- content_type CHECK ---');
  for (const r of chk.rows) console.log(' ', r.def);
} finally {
  await client.end();
}
