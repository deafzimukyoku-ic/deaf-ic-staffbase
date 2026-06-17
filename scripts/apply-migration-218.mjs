/* migration 218: shift_assignments.assignment_type に am_off/pm_off を追加 + 検証
   - CHECK制約の新定義を確認
   - am_off/pm_off の INSERT が通る (旧定義では弾かれた) ことを rollback 付きで実証 */
import pg from 'pg';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];})
);
const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
const m = dbUrl.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) throw new Error('DB URL parse fail');
const migrationSql = fs.readFileSync(path.resolve(__dirname,'..','supabase','migrations','218_shift_assignment_halfday.sql'),'utf8');
const client = new pg.Client({
  host:`db.${m[3]}.supabase.co`, port:5432, user:'postgres',
  password:decodeURIComponent(m[2]), database:'postgres', ssl:{rejectUnauthorized:false},
});

await client.connect();
try {
  console.log('--- applying migration 218 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const ck = await client.query(`
    SELECT pg_get_constraintdef(con.oid) def
      FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
     WHERE rel.relname='shift_assignments' AND n.nspname='public'
       AND con.conname='shift_assignments_assignment_type_check'`);
  console.log('新CHECK制約:', ck.rows[0]?.def);
  const ok = ck.rows[0]?.def?.includes('am_off') && ck.rows[0]?.def?.includes('pm_off');
  console.log(ok ? '✅ am_off/pm_off が制約に含まれる' : '!! 含まれない');

  // 実 INSERT 検証 (rollback) — 落合さんの本部7/13 に am_off を試す
  const sample = await client.query(`
    SELECT tenant_id, facility_id, employee_id FROM public.shift_assignments LIMIT 1`);
  if (sample.rows[0]) {
    const s = sample.rows[0];
    await client.query('BEGIN');
    try {
      await client.query(`
        INSERT INTO public.shift_assignments
          (tenant_id, facility_id, employee_id, date, assignment_type, publish_status, segment_order, start_time, end_time)
        VALUES ($1,$2,$3,'2099-12-31','am_off','draft',0,'14:30','18:00')`,
        [s.tenant_id, s.facility_id, s.employee_id]);
      console.log('✅ am_off の INSERT 成功 (制約を通過)');
      await client.query('ROLLBACK');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! am_off INSERT 失敗:', e.message.slice(0,120));
    }
  }
} finally {
  await client.end();
}
