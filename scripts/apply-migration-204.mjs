/* migration 204 (manuals manager RLS) を pooler 経由で適用 */
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
const password = decodeURIComponent(m[2]);
const ref = m[3];
const migrationSql = fs.readFileSync(path.resolve(projectRoot, 'supabase', 'migrations', '204_manuals_manager_rls.sql'), 'utf8');

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
  console.log('[BEFORE] manuals 上の manager 系ポリシー:');
  const before = await client.query(`
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.manuals'::regclass AND polname ILIKE '%manager%'
    ORDER BY polname
  `);
  for (const r of before.rows) console.log(' ', r.polname);
  if (before.rows.length === 0) console.log('  (無し)');

  console.log('\n--- applying migration 204 ---');
  await client.query(migrationSql);
  console.log('--- migration 204 applied ---\n');

  console.log('[AFTER] manuals 上の manager 系ポリシー:');
  const after = await client.query(`
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.manuals'::regclass AND polname ILIKE '%manager%'
    ORDER BY polname
  `);
  for (const r of after.rows) console.log(' ', r.polname);
} finally {
  await client.end();
}
