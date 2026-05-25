/* 4 機能テーブルの RLS と content_blocks カラムを実 DB から確認 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543, user: `postgres.${m[3]}`, password: decodeURIComponent(m[2]),
  database: 'postgres', ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  // テーブル名を実 DB から取得
  const ts = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND (table_name LIKE 'compliance%' OR table_name IN ('announcements','trainings','manuals'))
     ORDER BY table_name;`);
  console.log('=== related tables ===', ts.rows.map(r=>r.table_name));
  const tables = ['announcements','trainings','manuals', ...ts.rows.map(r=>r.table_name).filter(n=>n.startsWith('compliance'))];
  for (const t of tables) {
    console.log(`\n=== ${t} ===`);
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
         AND column_name IN ('content_blocks','body','content','pdf_storage_path','target_type','target_facility_ids','target_position_ids','category_id','tenant_id','facility_id')
       ORDER BY column_name;`, [t]);
    console.log(' columns:');
    for (const r of cols.rows) console.log(`  - ${r.column_name} ${r.data_type} nullable=${r.is_nullable}`);

    const pols = await client.query(`
      SELECT polname,
             CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                         WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                         WHEN '*' THEN 'ALL' END AS cmd,
             pg_get_expr(polqual, polrelid) AS using_expr,
             pg_get_expr(polwithcheck, polrelid) AS check_expr
        FROM pg_policy WHERE polrelid = ('public.'||$1)::regclass
       ORDER BY polname;`, [t]);
    console.log(' policies:');
    for (const r of pols.rows) {
      console.log(`  - ${r.polname} [${r.cmd}]`);
      if (r.using_expr) console.log(`      USING: ${(r.using_expr||'').replace(/\s+/g,' ').slice(0,180)}`);
      if (r.check_expr) console.log(`      CHECK: ${(r.check_expr||'').replace(/\s+/g,' ').slice(0,180)}`);
    }
  }

  console.log('\n=== サンプル: 実在する manuals の content_blocks 構造 ===');
  const sample = await client.query(`
    SELECT id, title, jsonb_typeof(content_blocks) AS t,
           jsonb_array_length(content_blocks) AS n,
           jsonb_path_query_array(content_blocks, '$[*].type') AS types
      FROM public.manuals
     WHERE content_blocks IS NOT NULL
       AND jsonb_typeof(content_blocks)='array'
     ORDER BY created_at DESC LIMIT 3;
  `);
  for (const r of sample.rows) console.log(`  ${r.id.slice(0,8)}.. "${r.title}" ${r.n} blocks types=${JSON.stringify(r.types)}`);

  console.log('\n=== 既存の content_blocks 内 image URL のパス検査 (signed URL か直接ストレージか) ===');
  const imgs = await client.query(`
    WITH blocks AS (
      SELECT id, title, jsonb_array_elements(content_blocks) AS b
        FROM public.manuals
       WHERE jsonb_typeof(content_blocks)='array'
    )
    SELECT id, title, b->>'type' AS type, substring(b->>'url' from 1 for 200) AS url_head
      FROM blocks
     WHERE b->>'type' = 'image'
     LIMIT 10;
  `);
  console.log(`  found ${imgs.rows.length} image blocks across all manuals`);
  for (const r of imgs.rows) console.log(`  ${r.title}: ${r.url_head?.slice(0,120)}...`);

  console.log('\n=== 同様 announcements/compliance/trainings の image block 集計 ===');
  const otherTables = tables.filter(t => t !== 'manuals');
  for (const t of otherTables) {
    const cnt = await client.query(`
      WITH blocks AS (
        SELECT jsonb_array_elements(content_blocks) AS b
          FROM public.${t}
         WHERE jsonb_typeof(content_blocks)='array'
      )
      SELECT count(*) FILTER (WHERE b->>'type'='image') AS imgs,
             count(*) FILTER (WHERE b->>'type'='video') AS vids,
             count(*) FILTER (WHERE b->>'type'='pdf') AS pdfs,
             count(*) FILTER (WHERE b->>'type'='text') AS txts
        FROM blocks;
    `);
    console.log(`  ${t}: ${JSON.stringify(cnt.rows[0])}`);
  }

  console.log('\n=== manager 役員の現状 ===');
  const mgrs = await client.query(`
    SELECT id, email, last_name, first_name, role, status, facility_id
      FROM public.employees WHERE role='manager' AND status='active';
  `);
  for (const r of mgrs.rows) console.log(`  ${r.email} (${r.last_name}${r.first_name}) facility=${r.facility_id}`);

  console.log('\n=== get_my_managed_facility_ids 関数の有無 ===');
  const fn = await client.query(`
    SELECT proname, prokind, pg_get_function_arguments(oid) args
      FROM pg_proc
     WHERE proname IN ('get_my_facility_ids','get_my_managed_facility_ids','get_my_role','get_my_employee_id');
  `);
  for (const r of fn.rows) console.log(`  ${r.proname}(${r.args})`);
} finally {
  await client.end();
}
