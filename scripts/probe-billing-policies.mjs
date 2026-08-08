/* 一時調査: 料金表まわりのテーブルの実 DB ポリシー本体を引く。
   CLAUDE.md §4 の警告どおり「ポリシー名でロールを判断しない」ため qual 本文を出す。
   新規テーブル（請求項目マスタ等）を足すときに同じ述語を揃える必要があるので、正本を確認する。
   読み取りのみ。 */
import { createPgClient } from './_db.mjs';

const client = createPgClient();
await client.connect();
const { rows } = await client.query(`
  select tablename, policyname, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and tablename in ('billing_summaries','billing_event_participations','events','children','facility_shift_settings')
  order by tablename, policyname
`);
for (const r of rows) {
  console.log(`\n--- ${r.tablename} / ${r.policyname} (${r.cmd}) ---`);
  console.log('  USING     :', (r.qual ?? '').replace(/\s+/g, ' '));
  if (r.with_check) console.log('  WITH CHECK:', r.with_check.replace(/\s+/g, ' '));
}

/* children の実列（兄弟・他施設利用の列がまだ無いことの確認） */
const { rows: cols } = await client.query(`
  select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name in ('children','billing_summaries','events')
  order by table_name, ordinal_position
`);
let cur = '';
const { rows: colsT } = await client.query(`
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema='public' and table_name in ('children','billing_summaries','events')
  order by table_name, ordinal_position
`);
for (const c of colsT) {
  if (c.table_name !== cur) { cur = c.table_name; console.log(`\n=== ${cur} 列 ===`); }
  console.log(`  ${c.column_name} : ${c.data_type}`);
}
void cols;

await client.end();
