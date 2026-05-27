/* migration 211 (can_access_media_path RPC) を本番 DB に適用 + 検証 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(projectRoot, '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) throw new Error('DATABASE_URL parse fail');

const sql = fs.readFileSync(
  path.resolve(projectRoot, 'supabase', 'migrations', '211_can_access_media_path_rpc.sql'),
  'utf8'
);

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${m[3]}`,
  password: decodeURIComponent(m[2]),
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  console.log('--- applying migration 211 ---');
  await client.query(sql);
  console.log('--- applied ---\n');

  console.log('=== verify: function can_access_media_path exists + executable by authenticated ===');
  const fn = await client.query(`
    SELECT n.nspname, p.proname, pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS result,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'can_access_media_path';
  `);
  if (fn.rowCount === 0) throw new Error('function not found');
  console.log(JSON.stringify(fn.rows[0], null, 2));
  if (!fn.rows[0].authenticated_can_execute) {
    throw new Error('authenticated does not have execute privilege');
  }
  console.log('\nOK: can_access_media_path 関数が存在 + authenticated 実行可');
} finally {
  await client.end();
}
