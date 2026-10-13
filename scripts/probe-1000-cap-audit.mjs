/* 1000 行上限の点検（2026-10-13）: ページングしていない各画面のクエリが、
   今のデータで「本来何行返すべきか」を SQL で数える。1000 超 = PostgREST が黙って切り捨てている */
import { createPgClient, loadEnv } from './_db.mjs';

const c = createPgClient(loadEnv());
await c.connect();
const q = async (label, sql, params = []) => {
  const { rows } = await c.query(sql, params);
  for (const r of rows) {
    const n = Number(r.n);
    console.log(`${n > 1000 ? '❌ 超過' : n > 700 ? '⚠ 接近' : '  ok  '} ${String(n).padStart(6)}  ${label}${r.k ? ' / ' + r.k : ''}`);
  }
};
const months = ['2026-09', '2026-10', '2026-11'];

console.log('--- 閲覧レポート /api/reports（法人全体・期間指定なし） ---');
for (const t of ['compliance_view_logs', 'training_view_logs', 'announcement_view_logs', 'manual_view_logs'])
  await q(t, `select tenant_id::text k, count(*) n from ${t} group by 1`);

console.log('--- 管理者ダッシュボード /admin/dashboard（条件なし全件） ---');
for (const t of ['compliance_acknowledgments', 'announcement_reads', 'manual_reads'])
  await q(t, `select count(*) n from ${t}`);
await q('training_submissions(result=passed)', `select count(*) n from training_submissions where result='passed'`);

console.log('--- シフト管理ダッシュボード（admin: 法人全体×1か月） ---');
for (const m of months) {
  await q(`schedule_entries ${m}`, `select count(*) n from schedule_entries where to_char(date,'YYYY-MM')=$1`, [m]);
  await q(`shift_assignments ${m}`, `select count(*) n from shift_assignments where to_char(date,'YYYY-MM')=$1`, [m]);
  await q(`transport_assignments ${m}`, `select count(*) n from transport_assignments t join schedule_entries s on s.id=t.schedule_entry_id where to_char(s.date,'YYYY-MM')=$1`, [m]);
}

console.log('--- 施設×1か月（シフト表・送迎表・利用表・料金表など） ---');
for (const m of months) {
  await q(`shift_assignments ${m}`, `select f.name k, count(*) n from shift_assignments x join facilities f on f.id=x.facility_id where to_char(date,'YYYY-MM')=$1 group by 1`, [m]);
  await q(`schedule_entries ${m}`, `select f.name k, count(*) n from schedule_entries x join facilities f on f.id=x.facility_id where to_char(date,'YYYY-MM')=$1 group by 1`, [m]);
}

console.log('--- 請求項目設定（項目の使用数＝全期間） ---');
await q('billing_summary_fee_amounts', `select f.name k, count(*) n from billing_summary_fee_amounts x join facilities f on f.id=x.facility_id group by 1`);

console.log('--- 社員本人ぶん（個人の閲覧ログ・確認記録の最大） ---');
for (const t of ['compliance_view_logs', 'announcement_view_logs', 'manual_view_logs', 'compliance_acknowledgments'])
  await q(`${t} 1人あたり最大`, `select max(n) n from (select count(*) n from ${t} group by employee_id) s`);
await c.end();
