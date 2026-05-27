/* migration 210 (documents RLS active only) を本番 DB に適用 + 検証 */
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
  path.resolve(projectRoot, 'supabase', 'migrations', '210_documents_rls_active_only.sql'),
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
  console.log('--- applying migration 210 ---');
  await client.query(sql);
  console.log('--- applied ---\n');

  console.log('=== verify: storage.objects policies for documents ===');
  const pols = await client.query(`
    SELECT polname,
           CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                       WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                       WHEN '*' THEN 'ALL' END AS cmd,
           pg_get_expr(polqual, polrelid) AS using_expr
      FROM pg_policy
     WHERE polrelid='storage.objects'::regclass
       AND polname LIKE 'documents:%'
     ORDER BY polname;
  `);
  for (const r of pols.rows) {
    console.log(`  - ${r.polname} [${r.cmd}]`);
    if (!/status\s*=\s*'active'/.test(r.using_expr || '')) {
      throw new Error(`policy ${r.polname} does not contain status='active'`);
    }
  }
  if (pols.rows.length !== 2) {
    throw new Error(`expected 2 policies, got ${pols.rows.length}`);
  }
  console.log("\nOK: 2 ポリシー + 全てに status='active' 条件あり");
} finally {
  await client.end();
}
