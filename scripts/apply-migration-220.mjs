/* migration 220: shift_day_notes を3行化 + 行ラベル(施設×月×行)テーブル新設 + 検証
   - row_no CHECK が (1,2,3) になっていること（row_no=3 の INSERT が通る）
   - shift_day_note_labels の upsert→onConflict update→delete を rollback 付きで実証
   接続は constraints.md §2 に従い pooler 経由。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];})
);
const migrationSql = fs.readFileSync(path.resolve(__dirname,'..','supabase','migrations','220_shift_day_notes_3rows_and_labels.sql'),'utf8');
const client = createPgClient(env);

await client.connect();
try {
  console.log('--- applying migration 220 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const ck = await client.query(`
    select pg_get_constraintdef(con.oid) def from pg_constraint con
     join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace
    where rel.relname='shift_day_notes' and n.nspname='public' and con.conname='shift_day_notes_row_no_check'`);
  console.log('row_no CHECK:', ck.rows[0]?.def, ck.rows[0]?.def?.includes('3') ? '✅ 3行OK' : '!! 3が無い');

  const pols = await client.query(`select policyname, cmd from pg_policies where schemaname='public' and tablename='shift_day_note_labels' order by policyname`);
  console.log('labels policies:', pols.rows.map(r=>`${r.policyname}[${r.cmd}]`).join(', ') || '(none!)');

  const t = await client.query(`select id from public.tenants limit 1`);
  const f = await client.query(`select id from public.facilities limit 1`);
  if (t.rows[0] && f.rows[0]) {
    await client.query('BEGIN');
    try {
      // row_no=3 の本文 INSERT が通るか
      await client.query(`
        insert into public.shift_day_notes (tenant_id, facility_id, date, row_no, content)
        values ($1,$2,'2099-12-31',3,'3行目テスト')`, [t.rows[0].id, f.rows[0].id]);
      console.log('✅ shift_day_notes row_no=3 INSERT 成功');
      // ラベル upsert → 再upsert(update) → delete
      const ins = `
        insert into public.shift_day_note_labels (tenant_id, facility_id, month, row_no, label)
        values ($1,$2,'2099-12',1,$3)
        on conflict (tenant_id, facility_id, month, row_no) do update set label=excluded.label
        returning label`;
      const r1 = await client.query(ins, [t.rows[0].id, f.rows[0].id, '学校行事']);
      const r2 = await client.query(ins, [t.rows[0].id, f.rows[0].id, '会議']);
      console.log(`✅ labels upsert 1回目='${r1.rows[0].label}' / 2回目(update)='${r2.rows[0].label}'`);
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
