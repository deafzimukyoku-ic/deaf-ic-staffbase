/* migration 219: shift_day_notes（シフト表 日別メモ2行）新設 + 検証
   - テーブル・UNIQUE・トリガ・RLS ポリシー2本の存在確認
   - upsert → 再 upsert（onConflict 経路）→ delete を rollback 付きで実証
   接続は constraints.md §2 に従い pooler 経由（直接ホストは IPv6-only で不安定） */
import pg from 'pg';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];})
);
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) throw new Error('DATABASE_URL parse fail');
const migrationSql = fs.readFileSync(path.resolve(__dirname,'..','supabase','migrations','219_shift_day_notes.sql'),'utf8');
const client = new pg.Client({
  host:'aws-1-ap-southeast-1.pooler.supabase.com', port:6543,
  user:`postgres.${m[3]}`, password:decodeURIComponent(m[2]),
  database:'postgres', ssl:{rejectUnauthorized:false},
});

await client.connect();
try {
  console.log('--- applying migration 219 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const cols = await client.query(`
    select column_name, data_type from information_schema.columns
     where table_schema='public' and table_name='shift_day_notes' order by ordinal_position`);
  console.log('columns:', cols.rows.map(r=>`${r.column_name}(${r.data_type})`).join(', '));

  const pols = await client.query(`
    select policyname, cmd from pg_policies
     where schemaname='public' and tablename='shift_day_notes' order by policyname`);
  console.log('policies:', pols.rows.map(r=>`${r.policyname}[${r.cmd}]`).join(', ') || '(none!)');

  // upsert → 再 upsert → delete を rollback 付きで検証
  const t = await client.query(`select id from public.tenants limit 1`);
  const f = await client.query(`select id from public.facilities limit 1`);
  if (t.rows[0] && f.rows[0]) {
    await client.query('BEGIN');
    try {
      const ins = `
        insert into public.shift_day_notes (tenant_id, facility_id, date, row_no, content)
        values ($1,$2,'2099-12-31',1,$3)
        on conflict (tenant_id, facility_id, date, row_no) do update set content = excluded.content
        returning content`;
      const r1 = await client.query(ins, [t.rows[0].id, f.rows[0].id, '会議 10:00']);
      const r2 = await client.query(ins, [t.rows[0].id, f.rows[0].id, '運動会']);
      console.log(`✅ upsert 1回目='${r1.rows[0].content}' / 2回目(onConflict update)='${r2.rows[0].content}'`);
      await client.query(`delete from public.shift_day_notes where date='2099-12-31'`);
      console.log('✅ delete OK');
      await client.query('ROLLBACK');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! 検証失敗:', e.message.slice(0,160));
      process.exitCode = 1;
    }
  }
} finally {
  await client.end();
}
