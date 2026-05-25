/* migration 206 (categories で manager_facilities 兼任を考慮) を pooler 経由で適用 */
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
  console.error('DATABASE_URL の形式が想定外です');
  process.exit(1);
}
const password = decodeURIComponent(m[2]);
const ref = m[3];
const migrationSql = fs.readFileSync(
  path.resolve(projectRoot, 'supabase', 'migrations', '206_category_audience_managed_facilities_fix.sql'),
  'utf8'
);

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
  console.log('--- applying migration 206 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  // categories ポリシー確認
  const catPol = await client.query(`
    SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS check_expr
      FROM pg_policy WHERE polrelid = 'public.categories'::regclass
     ORDER BY polname
  `);
  console.log('categories RLS:');
  for (const r of catPol.rows) {
    console.log(`  - ${r.polname}`);
    console.log(`      USING: ${(r.using_expr || '').slice(0, 200)}`);
    if (r.check_expr) console.log(`      CHECK: ${(r.check_expr || '').slice(0, 200)}`);
  }

  // manuals.manager_manage_manuals 確認
  const manPol = await client.query(`
    SELECT polname, pg_get_expr(polwithcheck, polrelid) AS check_expr
      FROM pg_policy WHERE polrelid = 'public.manuals'::regclass
       AND polname = 'manager_manage_manuals'
  `);
  console.log('\nmanuals.manager_manage_manuals:');
  for (const r of manPol.rows) {
    console.log(`  WITH CHECK present: ${r.check_expr ? 'YES' : 'NO'}`);
  }

  // 既存カテゴリ created_by 分布
  const byCreated = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_by IS NULL)::int AS null_count,
      COUNT(*) FILTER (WHERE created_by IS NOT NULL)::int AS set_count,
      COUNT(*)::int AS total
      FROM public.categories
  `);
  console.log('\ncategories.created_by 分布:', byCreated.rows[0]);
} finally {
  await client.end();
}
