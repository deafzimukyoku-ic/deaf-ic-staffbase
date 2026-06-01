/* パレット 6月シフトが employee に見えない件 — RLS 真因調査
   1. shift_assignments の RLS policy 一覧 (employee SELECT が本当に存在するか)
   2. ヘルパー関数 get_my_role / get_my_tenant_id / get_my_facility_ids の実体
   3. tenant 整合性 (shift_assignments.tenant_id vs employees.tenant_id)
   4. ★実 employee の identity を request.jwt.claims に注入して、実際に
      published 6月シフトが SELECT できるか(=RLS が通るか)を再現テスト */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) throw new Error('DATABASE_URL parse fail');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 6543,
  user: `postgres.${m[3]}`, password: decodeURIComponent(m[2]),
  database: 'postgres', ssl: { rejectUnauthorized: false },
});

const PALETTE = 'cc92a6de-0b33-4bbd-a805-1e8d95865272';
const FROM = '2026-06-01', TO = '2026-06-30';

await client.connect();
try {
  // 1. shift_assignments RLS policies
  console.log('=== shift_assignments RLS policies ===');
  const pols = await client.query(`
    SELECT polname,
           CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                       WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                       WHEN '*' THEN 'ALL' END AS cmd,
           pg_get_expr(polqual, polrelid) AS using_expr
      FROM pg_policy WHERE polrelid = 'public.shift_assignments'::regclass
      ORDER BY polcmd, polname;`);
  for (const r of pols.rows) {
    console.log(`  - ${r.polname} [${r.cmd}]`);
    if (r.using_expr) console.log(`      USING: ${r.using_expr}`);
  }
  const rls = await client.query(`select relrowsecurity, relforcerowsecurity from pg_class where oid='public.shift_assignments'::regclass`);
  console.log('  RLS enabled:', rls.rows[0]);

  // 2. helper functions
  console.log('\n=== helper function defs ===');
  const fns = await client.query(`
    SELECT proname, pg_get_functiondef(oid) AS def
      FROM pg_proc
     WHERE proname IN ('get_my_role','get_my_tenant_id','get_my_facility_ids')
       AND pronamespace='public'::regnamespace ORDER BY proname;`);
  for (const r of fns.rows) console.log(`\n--- ${r.proname} ---\n${r.def}`);

  // 3. tenant 整合性
  console.log('\n=== tenant 整合性 ===');
  const t1 = await client.query(
    `select tenant_id, count(*) n from shift_assignments where facility_id=$1 and date>=$2 and date<=$3 group by tenant_id`,
    [PALETTE, FROM, TO]);
  console.log('shift_assignments.tenant_id:', t1.rows);
  const t2 = await client.query(
    `select tenant_id, role, (auth_user_id is not null) has_auth, status, count(*) n
       from employees where facility_id=$1 group by tenant_id, role, (auth_user_id is not null), status order by role`,
    [PALETTE]);
  console.log('employees(主所属パレット):', t2.rows);

  // 4. 実 employee identity で RLS 再現テスト
  console.log('\n=== RLS 再現テスト (実 employee の JWT claims を注入) ===');
  const emp = await client.query(
    `select id, auth_user_id, tenant_id, last_name, first_name, role
       from employees
      where facility_id=$1 and role='employee' and status='active' and auth_user_id is not null
      order by last_name limit 1`, [PALETTE]);
  if (emp.rows.length === 0) {
    console.log('!! auth_user_id を持つ active employee が居ません');
  } else {
    const e = emp.rows[0];
    console.log(`対象 employee: ${e.last_name} ${e.first_name} | id=${e.id} | auth=${e.auth_user_id} | role=${e.role} | tenant=${e.tenant_id}`);
    const claims = JSON.stringify({ sub: e.auth_user_id, role: 'authenticated' });

    await client.query('BEGIN');
    await client.query(`set local role authenticated`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);

    // 4a. helper 関数が何を返すか
    const who = await client.query(`select get_my_role() role, get_my_tenant_id() tenant`);
    console.log('  get_my_role()=', who.rows[0].role, ' get_my_tenant_id()=', who.rows[0].tenant);
    let facIds;
    try {
      const f = await client.query(`select array(select get_my_facility_ids()) ids`);
      facIds = f.rows[0].ids;
      console.log('  get_my_facility_ids()=', facIds, ' (パレット含む?', (facIds||[]).includes(PALETTE), ')');
    } catch (err) { console.log('  get_my_facility_ids() ERROR:', err.message); }

    // 4b. ★実クエリ: MyFacilityShiftView と同じ条件
    const seen = await client.query(
      `select count(*) n from shift_assignments
        where facility_id = any($1) and publish_status='published' and date>=$2 and date<=$3`,
      [facIds && facIds.length ? facIds : [PALETTE], FROM, TO]);
    console.log(`  ★ employee から見える published 6月 shift_assignments: ${seen.rows[0].n} 件 (RLS 適用後)`);

    // 4c. facility_id フィルタ無し(自分の全可視行)でも確認
    const seenAll = await client.query(
      `select publish_status, count(*) n from shift_assignments
        where facility_id=$1 and date>=$2 and date<=$3 group by publish_status`,
      [PALETTE, FROM, TO]);
    console.log('  employee から見えるパレット6月 (status別):', seenAll.rows);

    await client.query('ROLLBACK');
  }

  // 5. notification_queue 全体像
  console.log('\n=== notification_queue (パレット facility / shift_* tenant全体) ===');
  const nq = await client.query(`
    select 'palette_any' scope, content_type, count(*) n, max(scheduled_at) latest, count(sent_at) sent, count(cancelled_at) cancelled
      from notification_queue where facility_id=$1 group by content_type
    union all
    select 'shift_tenant_since_0501', content_type, count(*), max(scheduled_at), count(sent_at), count(cancelled_at)
      from notification_queue where content_type in ('shift_ready','shift_publish') and scheduled_at>='2026-05-01' group by content_type`,
    [PALETTE]);
  console.log(nq.rows);
} finally {
  await client.end();
}
