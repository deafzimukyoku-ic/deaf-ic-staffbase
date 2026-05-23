/* migration 200 (push_subscriptions) を pooler 経由で適用 */
import pg from 'pg';
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
const password = decodeURIComponent(m[2]);
const ref = m[3];
const migrationSql = fs.readFileSync(path.resolve(projectRoot, 'supabase', 'migrations', '200_push_subscriptions.sql'), 'utf8');

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
  console.log('[BEFORE] checking push_subscriptions table existence...');
  const before = await client.query(`
    SELECT to_regclass('public.push_subscriptions') AS exists_as
  `);
  console.log('  ->', before.rows[0].exists_as ?? '(not yet)');

  console.log('\n--- applying migration 200 ---');
  await client.query(migrationSql);
  console.log('--- migration 200 applied ---\n');

  const after = await client.query(`
    SELECT to_regclass('public.push_subscriptions') AS exists_as
  `);
  console.log('[AFTER] push_subscriptions:', after.rows[0].exists_as);

  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
    ORDER BY ordinal_position
  `);
  console.log('\n--- columns ---');
  for (const c of cols.rows) console.log(' ', c.column_name, '|', c.data_type, '| nullable=', c.is_nullable);

  const policies = await client.query(`
    SELECT polname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'
    ORDER BY polname
  `).catch(() => ({ rows: [] }));
  /* pg_policies は cmd 列を持たないため fallback */
  const policies2 = await client.query(`
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'
    ORDER BY policyname
  `);
  console.log('\n--- RLS policies ---');
  for (const p of policies2.rows) console.log(' ', p.policyname, '|', p.cmd);
} finally {
  await client.end();
}
