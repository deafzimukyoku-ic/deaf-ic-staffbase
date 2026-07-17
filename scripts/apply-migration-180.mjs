/* migration 180 を pooler 経由で適用。before/after を表示して検証 */
import { createPgClient, loadEnv } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = loadEnv();
const migrationSql = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'migrations', '180_notification_queue_first_scheduled.sql'), 'utf8');

const client = createPgClient(env);

async function snapshot(label) {
  const s = await client.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL) AS pending,
      COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled,
      COUNT(*) FILTER (WHERE sent_at IS NULL AND cancelled_at IS NULL AND scheduled_at < now() - interval '24 hours') AS pending_overdue_24h
    FROM public.notification_queue;
  `);
  const col = await client.query(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notification_queue' AND column_name='first_scheduled_at';
  `);
  const idx = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='notification_queue' AND indexname='idx_notif_queue_pending_scheduled';
  `);
  console.log(`[${label}]`);
  console.log('  ', s.rows[0]);
  console.log('   first_scheduled_at column:', col.rowCount > 0 ? `present (nullable=${col.rows[0].is_nullable})` : 'absent');
  console.log('   idx_notif_queue_pending_scheduled:', idx.rowCount > 0 ? 'present' : 'absent');
}

await client.connect();
try {
  await snapshot('BEFORE');
  console.log('\n--- applying migration 180 ---');
  await client.query(migrationSql);
  console.log('--- migration 180 applied ---\n');
  await snapshot('AFTER');

  /* 全 pending 行に first_scheduled_at が入ったか確認 */
  const orphan = await client.query(`
    SELECT COUNT(*) AS missing FROM public.notification_queue
    WHERE first_scheduled_at IS NULL;
  `);
  console.log('\nrows missing first_scheduled_at:', orphan.rows[0].missing);
} finally {
  await client.end();
}
