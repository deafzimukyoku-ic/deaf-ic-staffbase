/* 2026-10-13 の 1000 行上限修正の検証: 直した後のクエリ形（ページング / 件数）を本番に投げ、
   SQL で数えた正解と一致するかを見る。service role なので RLS は通らない（ロール別は画面で確認） */
import { createClient } from '@supabase/supabase-js';
import { createPgClient, loadEnv } from './_db.mjs';

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const pg = createPgClient(env);
await pg.connect();
const sql = async (s, p = []) => Number((await pg.query(s, p)).rows[0].n);

/* lib/multi-facility.ts の fetchAllRows と同じ実装（.ts を直接読めないため写し） */
async function fetchAllRows(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return out;
}
let ng = 0;
const check = (label, got, want, extra = '') => {
  const ok = got === want;
  if (!ok) ng++;
  console.log(`${ok ? '✅' : '❌'} ${label}: 取得 ${got} / 正解 ${want} ${extra}`);
};

const { rows: [{ id: tenantId }] } = await pg.query('select id from tenants limit 1');

console.log('--- 閲覧レポート（ページング取得） ---');
for (const t of ['compliance_view_logs', 'training_view_logs', 'announcement_view_logs', 'manual_view_logs']) {
  for (const ps of [1000, 333]) {
    const rows = await fetchAllRows(() => sb.from(t).select('id, employee_id, item_id, viewed_at').eq('tenant_id', tenantId).order('id', { ascending: true }), ps);
    const uniq = new Set(rows.map((r) => r.id)).size;
    check(`${t} pageSize=${ps}`, rows.length, await sql(`select count(*) n from ${t} where tenant_id=$1`, [tenantId]), `（重複なし: ${uniq === rows.length}）`);
  }
}

console.log('--- 管理者ダッシュボード（ページング取得） ---');
const dash = [
  ['document_submissions', 'id, employee_id', ['id'], ['status', 'submitted'], `status='submitted'`],
  ['compliance_acknowledgments', 'id, employee_id', ['id'], null, 'true'],
  ['training_submissions', 'id, employee_id', ['id'], ['result', 'passed'], `result='passed'`],
  ['announcement_reads', 'announcement_id, employee_id', ['announcement_id', 'employee_id'], null, 'true'],
  ['manual_reads', 'manual_id, employee_id', ['manual_id', 'employee_id'], null, 'true'],
];
for (const [t, cols, order, filter, where] of dash) {
  for (const ps of [1000, 250]) {
    const rows = await fetchAllRows(() => {
      let q = sb.from(t).select(cols);
      if (filter) q = q.eq(filter[0], filter[1]);
      for (const c of order) q = q.order(c, { ascending: true });
      return q;
    }, ps);
    const uniq = new Set(rows.map((r) => JSON.stringify(r))).size;
    check(`${t} pageSize=${ps}`, rows.length, await sql(`select count(*) n from ${t} where ${where}`), `（重複なし: ${uniq === rows.length}）`);
  }
}

console.log('--- シフト管理ダッシュボード（件数） ---');
const co = { count: 'exact', head: true };
for (const [from, to] of [['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30']]) {
  const r = await Promise.all([
    sb.from('shift_assignments').select('id', co).eq('tenant_id', tenantId).gte('date', from).lte('date', to),
    sb.from('shift_assignments').select('id', co).eq('tenant_id', tenantId).gte('date', from).lte('date', to).neq('publish_status', 'published'),
    sb.from('transport_assignments').select('id, schedule_entries!inner(date)', co).eq('tenant_id', tenantId).gte('schedule_entries.date', from).lte('schedule_entries.date', to),
    sb.from('transport_assignments').select('id, schedule_entries!inner(date)', co).eq('tenant_id', tenantId).gte('schedule_entries.date', from).lte('schedule_entries.date', to).neq('publish_status', 'published'),
  ]);
  for (const x of r) if (x.error) throw x.error;
  const m = from.slice(0, 7);
  check(`${m} シフト 全件`, r[0].count, await sql(`select count(*) n from shift_assignments where tenant_id=$1 and date between $2 and $3`, [tenantId, from, to]));
  check(`${m} シフト 未公開`, r[1].count, await sql(`select count(*) n from shift_assignments where tenant_id=$1 and date between $2 and $3 and publish_status<>'published'`, [tenantId, from, to]));
  check(`${m} 送迎 全件`, r[2].count, await sql(`select count(*) n from transport_assignments t join schedule_entries s on s.id=t.schedule_entry_id where t.tenant_id=$1 and s.date between $2 and $3`, [tenantId, from, to]));
  check(`${m} 送迎 未公開`, r[3].count, await sql(`select count(*) n from transport_assignments t join schedule_entries s on s.id=t.schedule_entry_id where t.tenant_id=$1 and s.date between $2 and $3 and t.publish_status<>'published'`, [tenantId, from, to]));
}
await pg.end();
console.log(ng === 0 ? '\n全項目一致' : `\n❌ 不一致 ${ng} 件`);
process.exit(ng === 0 ? 0 : 1);
