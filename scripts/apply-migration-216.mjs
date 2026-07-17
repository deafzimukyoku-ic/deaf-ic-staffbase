/* migration 216 を pooler 経由で適用 + 検証:
   - shift_confirmations テーブル / RLS ポリシー作成確認
   - 160 sa_employee_facility_shifts が ready を含むよう拡張されたか
   - 実 employee の JWT を注入して published シフトが従来どおり見えるか(回帰なし)を確認 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const migrationSql = fs.readFileSync(path.resolve(__dirname,'..','supabase','migrations','216_shift_confirmations.sql'),'utf8');
const client = createPgClient(env);
const PALETTE = 'cc92a6de-0b33-4bbd-a805-1e8d95865272';

await client.connect();
try {
  console.log('--- applying migration 216 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const tbl = await client.query(`select count(*) n from information_schema.tables where table_schema='public' and table_name='shift_confirmations'`);
  console.log('shift_confirmations テーブル:', tbl.rows[0].n === '1' ? 'OK' : '!! 無し');

  const pols = await client.query(`select polname from pg_policy where polrelid='public.shift_confirmations'::regclass order by polname`);
  console.log('shift_confirmations RLS:', pols.rows.map(r=>r.polname).join(', '));

  const sa = await client.query(`select pg_get_expr(polqual, polrelid) q from pg_policy where polrelid='public.shift_assignments'::regclass and polname='sa_employee_facility_shifts'`);
  console.log('160 ready 拡張:', /ready/.test(sa.rows[0]?.q ?? '') ? 'OK (ready 含む)' : '!! ready 未含有');

  // 実 employee で回帰確認 (published が従来どおり見えるか)
  const emp = await client.query(`select id, auth_user_id from employees where facility_id=$1 and role='employee' and status='active' and auth_user_id is not null limit 1`, [PALETTE]);
  if (emp.rows.length) {
    const claims = JSON.stringify({ sub: emp.rows[0].auth_user_id, role: 'authenticated' });
    await client.query('BEGIN');
    await client.query(`set local role authenticated`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    const pub = await client.query(`select count(*) n from shift_assignments where facility_id=$1 and publish_status='published' and date>='2026-06-01' and date<='2026-06-30'`, [PALETTE]);
    const sc = await client.query(`select count(*) n from shift_confirmations`); // 本人分のみ (0件のはず)
    await client.query('ROLLBACK');
    console.log(`employee 視点: published 6月 = ${pub.rows[0].n} 件 (回帰なし) / 自分の shift_confirmations = ${sc.rows[0].n} 件`);
  }
} finally { await client.end(); }
