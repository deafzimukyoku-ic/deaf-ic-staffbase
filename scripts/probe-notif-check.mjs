/* notification_queue.content_type の CHECK 制約に shift_ready/shift_publish が含まれるか */
import pg from 'pg';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const client = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:6543, user:`postgres.${m[3]}`, password:decodeURIComponent(m[2]), database:'postgres', ssl:{rejectUnauthorized:false} });
await client.connect();
try {
  console.log('=== notification_queue CHECK 制約 ===');
  const ck = await client.query(`
    select conname, pg_get_constraintdef(oid) def
      from pg_constraint
      where conrelid='public.notification_queue'::regclass and contype='c'`);
  for (const r of ck.rows) console.log(`  ${r.conname}: ${r.def}`);

  console.log('\n=== notification_queue カラム ===');
  const cols = await client.query(`
    select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema='public' and table_name='notification_queue' order by ordinal_position`);
  console.table(cols.rows);

  console.log('\n=== facility_id / meta / first_scheduled_at / created_by の有無確認済 ===');
  // 実際に shift_publish を insert できるか dry-run (ROLLBACK)
  console.log('\n=== shift_publish INSERT dry-run (ROLLBACK) ===');
  try {
    await client.query('BEGIN');
    const tenant = await client.query(`select tenant_id from facilities where id='cc92a6de-0b33-4bbd-a805-1e8d95865272'`);
    await client.query(`insert into notification_queue (tenant_id, facility_id, content_type, content_id, meta, scheduled_at)
      values ($1, 'cc92a6de-0b33-4bbd-a805-1e8d95865272', 'shift_publish', null, '{"year":2026,"month":6}'::jsonb, now())`,
      [tenant.rows[0].tenant_id]);
    console.log('  ✓ shift_publish INSERT 成功 (制約OK) — ROLLBACK します');
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log('  ✗ shift_publish INSERT 失敗:', err.message);
  }
} finally { await client.end(); }
