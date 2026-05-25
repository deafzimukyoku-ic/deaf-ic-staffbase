/* deaf-ic 本番 DB の storage.objects RLS 現状調査
   manuals 画像アップロード時の「new row violates row-level security policy」真因特定用 */
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
if (!m) throw new Error('DATABASE_URL parse fail');
const password = decodeURIComponent(m[2]);
const ref = m[3];

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
  console.log('=== storage.buckets where id IN (documents, employee-images) ===');
  const buckets = await client.query(`
    SELECT id, name, public, file_size_limit,
           array_to_string(allowed_mime_types, ',') AS mimes
      FROM storage.buckets
     WHERE id IN ('documents','employee-images','message-attachments');
  `);
  for (const r of buckets.rows) {
    console.log(`  ${r.id}: public=${r.public} size=${r.file_size_limit} mimes=${r.mimes}`);
  }

  console.log('\n=== storage.objects RLS policies (all, ordered) ===');
  const pols = await client.query(`
    SELECT polname,
           polcmd,
           CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                       WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                       WHEN '*' THEN 'ALL' END AS cmd,
           array_to_string(ARRAY(
             SELECT rolname FROM pg_roles WHERE oid = ANY(polroles)
           ), ',') AS roles,
           pg_get_expr(polqual, polrelid) AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS check_expr
      FROM pg_policy
     WHERE polrelid = 'storage.objects'::regclass
     ORDER BY polname;
  `);
  for (const r of pols.rows) {
    console.log(`  - ${r.polname} [${r.cmd}] roles=${r.roles}`);
    if (r.using_expr) console.log(`      USING : ${r.using_expr}`);
    if (r.check_expr) console.log(`      CHECK : ${r.check_expr}`);
  }

  console.log('\n=== RLS enabled on storage.objects? ===');
  const rls = await client.query(`
    SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE oid = 'storage.objects'::regclass;
  `);
  console.log('  ', rls.rows[0]);

  console.log('\n=== 直近 documents バケットへの INSERT 失敗形跡: 既存 owner/role 分布 ===');
  const dist = await client.query(`
    SELECT owner, count(*)
      FROM storage.objects
     WHERE bucket_id = 'documents'
     GROUP BY owner
     ORDER BY 2 DESC LIMIT 10;
  `);
  for (const r of dist.rows) console.log(`  owner=${r.owner ?? '(null)'} count=${r.count}`);

  console.log('\n=== 直近 documents の最新 5 件 (最後の成功例) ===');
  const recent = await client.query(`
    SELECT name, owner, created_at, last_accessed_at
      FROM storage.objects
     WHERE bucket_id = 'documents'
     ORDER BY created_at DESC LIMIT 5;
  `);
  for (const r of recent.rows) {
    console.log(`  ${r.created_at?.toISOString?.() ?? r.created_at}  owner=${r.owner ?? '(null)'}  ${r.name}`);
  }

  console.log('\n=== 2han2be4han@gmail.com の現在のロール ===');
  const me = await client.query(`
    SELECT e.id, e.email, e.role, e.tenant_id, e.facility_id
      FROM public.employees e
     WHERE e.email = '2han2be4han@gmail.com';
  `);
  for (const r of me.rows) console.log(`  ${JSON.stringify(r)}`);

  console.log('\n=== 渋江 (manager だった候補) 探索 ===');
  const shi = await client.query(`
    SELECT id, email, role, status
      FROM public.employees
     WHERE last_name LIKE '%渋%' OR last_name LIKE '%渋江%'
        OR email LIKE '%shibu%' OR email LIKE '%shibue%';
  `);
  for (const r of shi.rows) console.log(`  ${JSON.stringify(r)}`);
} finally {
  await client.end();
}
