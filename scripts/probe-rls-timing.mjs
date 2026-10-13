/* 性能調査（2026-10-13）: 管理者の JWT を偽装して、閲覧レポート API が投げるクエリを
   RLS 込みで実行し、DB 内の実行時間を測る。service role だと RLS を素通りして実態と違うため */
import { createPgClient, loadEnv } from './_db.mjs';

const c = createPgClient(loadEnv());
await c.connect();
const role = process.argv[2] ?? 'admin';
const { rows: [u] } = await c.query(`select auth_user_id, tenant_id from employees where role=$1 and status='active' and auth_user_id is not null limit 1`, [role]);
const queries = [
  ['employees(me)', `select id, tenant_id, role, facility_id from employees where auth_user_id = '${u.auth_user_id}'`],
  ['compliance_documents', `select id,title,target_type,target_facility_ids,target_position_ids,category_id,sort_order,created_at,updated_at from compliance_documents where tenant_id='${u.tenant_id}' order by sort_order, created_at`],
  ['categories', `select id,name,icon,color from categories where tenant_id='${u.tenant_id}' and type='compliance'`],
  ['employees(active)', `select id,employee_number,last_name,first_name,facility_id,position_id,role,status from employees where tenant_id='${u.tenant_id}' and status='active' and role<>'shift_manager'`],
  ['employee_facilities', `select employee_id, facility_id from employee_facilities`],
  ['facilities', `select id,name from facilities where tenant_id='${u.tenant_id}'`],
  ['compliance_view_logs p1', `select employee_id,item_id,viewed_at from compliance_view_logs where tenant_id='${u.tenant_id}' order by id limit 1000`],
  ['compliance_view_logs p2', `select employee_id,item_id,viewed_at from compliance_view_logs where tenant_id='${u.tenant_id}' order by id limit 1000 offset 1000`],
  ['announcement_view_logs', `select employee_id,item_id,viewed_at from announcement_view_logs where tenant_id='${u.tenant_id}' order by id limit 1000`],
];
for (const [label, sql] of queries) {
  await c.query('begin');
  await c.query(`set local role authenticated`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.auth_user_id, role: 'authenticated' })]);
  const t = performance.now();
  const { rows } = await c.query(sql);
  const ms = Math.round(performance.now() - t);
  await c.query('rollback');
  console.log(`${label.padEnd(26)} ${String(ms).padStart(6)}ms  rows=${rows.length}`);
}
await c.end();
