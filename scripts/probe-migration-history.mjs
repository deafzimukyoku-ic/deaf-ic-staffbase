/* deaf-ic 本番 DB の migration 適用履歴と storage policy 変更時期を追跡 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const client = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:6543,
  user:`postgres.${m[3]}`, password:decodeURIComponent(m[2]), database:'postgres', ssl:{rejectUnauthorized:false} });
await client.connect();
try {
  console.log('=== supabase_migrations schemas ===');
  const schemas = await client.query(`
    SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_name LIKE '%migration%' OR table_schema='supabase_migrations'
     ORDER BY table_schema, table_name;`);
  for (const r of schemas.rows) console.log(`  ${r.table_schema}.${r.table_name}`);

  console.log('\n=== supabase_migrations.schema_migrations (Supabase 標準) ===');
  try {
    const sm = await client.query(`
      SELECT version, name, statements IS NOT NULL AS has_sql, created_by, idempotency_key
        FROM supabase_migrations.schema_migrations
       ORDER BY version DESC LIMIT 30;`);
    for (const r of sm.rows) console.log(`  ${r.version} ${r.name ?? ''}`);
  } catch (e) {
    console.log('  (not found):', e.message.slice(0,100));
  }

  console.log('\n=== storage 関連の object 履歴 (created_at) ===');
  const ages = await client.query(`
    SELECT min(created_at) AS oldest, max(created_at) AS newest, count(*)
      FROM storage.objects WHERE bucket_id='documents';`);
  console.log(`  documents: oldest=${ages.rows[0].oldest?.toISOString?.()} newest=${ages.rows[0].newest?.toISOString?.()} count=${ages.rows[0].count}`);

  console.log('\n=== storage.objects 全件 (documents, created_at 順) ===');
  const all = await client.query(`
    SELECT name, owner, created_at
      FROM storage.objects WHERE bucket_id='documents'
     ORDER BY created_at ASC;`);
  for (const r of all.rows) console.log(`  ${r.created_at?.toISOString?.()}  ${r.name}`);

  // announcements 過去の image block 持ち投稿の作成日
  console.log('\n=== announcements の image block 含む投稿 (作成順) ===');
  const ann = await client.query(`
    SELECT id, title, created_at, updated_at,
           jsonb_path_query_array(content_blocks, '$[*].type') AS types,
           jsonb_array_elements_text(jsonb_path_query_array(content_blocks, '$[*] ? (@.type == "image").url')) AS img_url
      FROM public.announcements
     WHERE jsonb_typeof(content_blocks)='array';`);
  for (const r of ann.rows) {
    console.log(`  ${r.created_at?.toISOString?.()} "${r.title}" types=${JSON.stringify(r.types)} url='${(r.img_url||'').slice(0,80)}'`);
  }

  // ストレージ policy の変更時期を pg_class.pg_stat から探す
  console.log('\n=== pg_class for storage.objects (vacuum etc 時刻) ===');
  const pc = await client.query(`
    SELECT relname, reltuples, n_live_tup, last_vacuum, last_analyze
      FROM pg_class
      LEFT JOIN pg_stat_user_tables ON pg_class.oid = pg_stat_user_tables.relid
     WHERE relname='objects' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='storage');`);
  for (const r of pc.rows) console.log(`  ${JSON.stringify(r)}`);

  // pg_policies のオプション情報 (作成時刻は取れない, ただし migration vs dashboard を見極めるため policy 名から推測)
  console.log('\n=== documents 関連の policy 命名規則 ===');
  const pols = await client.query(`
    SELECT polname, pg_get_expr(polqual, polrelid) AS using_short,
           obj_description(oid, 'pg_policy') AS comment
      FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname LIKE 'documents%';`);
  for (const r of pols.rows) {
    console.log(`  ${r.polname}`);
    console.log(`    comment: ${r.comment ?? '(none)'}`);
  }
} finally { await client.end(); }
