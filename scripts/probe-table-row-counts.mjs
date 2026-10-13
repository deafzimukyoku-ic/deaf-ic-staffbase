/* 1000 行上限の点検用: public の全テーブルについて総行数と「施設別の最大行数」を出す。
   PostgREST は 1 リクエスト 1000 行で黙って打ち切るため、ここで 1000 に近い/超えるテーブルが要注意 */
import { createPgClient, loadEnv } from './_db.mjs';

const c = createPgClient(loadEnv());
await c.connect();
const { rows: tables } = await c.query(`
  select t.table_name,
         exists(select 1 from information_schema.columns c
                where c.table_schema='public' and c.table_name=t.table_name and c.column_name='facility_id') as has_fac
  from information_schema.tables t
  where t.table_schema='public' and t.table_type='BASE TABLE' order by 1`);
const out = [];
for (const t of tables) {
  const { rows: [{ n }] } = await c.query(`select count(*)::int as n from public."${t.table_name}"`);
  let maxFac = null;
  if (t.has_fac) {
    const { rows: [r] } = await c.query(`select coalesce(max(n),0)::int as m from (select count(*) n from public."${t.table_name}" group by facility_id) s`);
    maxFac = r.m;
  }
  out.push({ table: t.table_name, total: n, maxPerFacility: maxFac });
}
out.sort((a, b) => b.total - a.total);
for (const r of out) if (r.total >= 300)
  console.log(`${r.total >= 1000 ? '⚠' : ' '} ${r.table.padEnd(40)} total=${String(r.total).padStart(7)}  施設最大=${r.maxPerFacility ?? '-'}`);
await c.end();
