/* 先方要望④の核心検証: 「全施設が同時にシフト作成中(draft混在)」でも、
   マネージャーが自施設グリッドに出る兼任職員の“他施設 draft 行”を RLS 越しに SELECT できるか。

   手法: authenticated ロール + request.jwt.claims の sub を各 manager の auth_user_id に差し替えて
   RLS を実際に適用させる（postgres/service ロールは RLS をバイパスするため不可）。
   これで「draft でも見える＝相互反映できる」ことをアプリと同じ認可経路で立証する。 */
import pg from 'pg';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const client = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:6543, user:`postgres.${m[3]}`, password:decodeURIComponent(m[2]), database:'postgres', ssl:{rejectUnauthorized:false} });
await client.connect();

async function asUser(authUserId, fn) {
  await client.query('BEGIN');
  try {
    await client.query(`set local role authenticated`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authUserId, role: 'authenticated' })]);
    return await fn();
  } finally {
    await client.query('ROLLBACK'); // 読み取りのみ。ロール/claims をリセット
  }
}

try {
  const mgrs = await client.query(`
    select e.id, e.auth_user_id, e.facility_id, e.last_name||' '||e.first_name as name, f.name as facility
    from public.employees e join public.facilities f on f.id=e.facility_id
    where e.role='manager' and e.status='active' and e.auth_user_id is not null`);

  for (const mgr of mgrs.rows) {
    console.log(`\n===== manager: ${mgr.name}（主所属 ${mgr.facility}）=====`);
    // RLS 越しに、自分が見られる「他施設(自主所属以外)の出勤系 assignment」を publish_status 別に集計
    const seen = await asUser(mgr.auth_user_id, async () => {
      return client.query(`
        select f.name as work_facility, sa.publish_status,
               count(*) filter (where sa.assignment_type in ('normal','am_off','pm_off')) as working_rows
        from public.shift_assignments sa
        join public.employees e2 on e2.id = sa.employee_id
        join public.facilities f on f.id = sa.facility_id
        where sa.facility_id <> $1
          and to_char(sa.date,'YYYY-MM') in ('2026-07','2026-06')
        group by 1,2 order by 1,2`, [mgr.facility_id]);
    }).catch(e => ({ rows: [{ err: e.message.slice(0,80) }] }));
    console.table(seen.rows.length ? seen.rows : [{ info: 'RLS越しに他施設行は0件' }]);
  }
} catch (e) {
  console.log('probe error:', e.message);
} finally {
  await client.end();
}
