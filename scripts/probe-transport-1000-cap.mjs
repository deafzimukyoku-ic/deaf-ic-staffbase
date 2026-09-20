/* 仮説検証: 送迎表 (TransportFull) の transport_assignments 取得が
   .eq('facility_id') のみで日付無制限 → 施設の全期間行が 1000 行を超え、
   PostgREST の暗黙 max-rows(1000) で打ち切られ、保存した行が再取得で戻らない。
   1. 施設別 transport_assignments 総行数
   2. 2026-10-07 の行が実 DB に存在するか（= 保存自体は成功しているか）
   3. REST に count=exact で投げて打ち切りを実証 */
import { createPgClient, loadEnv } from './_db.mjs';

const env = loadEnv();
const c = createPgClient(env);
await c.connect();

const { rows: facs } = await c.query(`
  select f.id, f.name,
         (select count(*) from transport_assignments t where t.facility_id = f.id) as ta_total,
         (select count(*) from schedule_entries s where s.facility_id = f.id) as se_total
  from facilities f order by f.name`);
console.log('=== 施設別 行数 ===');
for (const f of facs) {
  console.log(`  ${f.name.padEnd(12)} transport_assignments=${String(f.ta_total).padStart(6)}  schedule_entries=${String(f.se_total).padStart(6)}  ${Number(f.ta_total) > 1000 ? '⚠ 1000 超' : ''}  ${f.id}`);
}

console.log('\n=== 2026-10-07 の送迎割当（実 DB） ===');
const { rows: oct } = await c.query(`
  select f.name as facility, ch.name as child,
         t.pickup_employee_ids, t.dropoff_employee_ids, t.is_locked, t.is_unassigned, t.created_at
  from transport_assignments t
  join schedule_entries s on s.id = t.schedule_entry_id
  join facilities f on f.id = t.facility_id
  left join children ch on ch.id = s.child_id
  where s.date = '2026-10-07'
  order by f.name, ch.name`);
if (oct.length === 0) console.log('  （0 件 — 保存されていない）');
for (const r of oct) {
  console.log(`  ${r.facility} / ${r.child}: pickup=${JSON.stringify(r.pickup_employee_ids)} dropoff=${JSON.stringify(r.dropoff_employee_ids)} locked=${r.is_locked} created=${r.created_at?.toISOString?.() ?? r.created_at}`);
}

console.log('\n=== 2026-10-07 の schedule_entries ===');
const { rows: se } = await c.query(`
  select f.name as facility, count(*) as n
  from schedule_entries s join facilities f on f.id = s.facility_id
  where s.date = '2026-10-07' group by f.name order by f.name`);
for (const r of se) console.log(`  ${r.facility}: ${r.n} 件`);

await c.end();

/* 3. REST 経由で実際に打ち切られるか */
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
console.log('\n=== PostgREST 打ち切り実証（TransportFull と同じクエリ） ===');
for (const f of facs) {
  const r = await fetch(`${BASE}/rest/v1/transport_assignments?select=*&facility_id=eq.${f.id}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
  });
  const cr = r.headers.get('content-range');
  const body = await r.json().catch(() => []);
  const total = cr?.split('/')[1] ?? '?';
  const returned = Array.isArray(body) ? body.length : 0;
  console.log(`  ${f.name.padEnd(12)} count=${String(total).padStart(6)} / 返却=${String(returned).padStart(6)} ${Number(total) > returned ? `⚠ ${total - returned} 行 欠落` : 'OK'}`);
}
