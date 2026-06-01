/* 「公開/仮確定済みなのに通知が送られていない」シフトを洗い出す。
   - 各 facility × 月 の publish_status（2026-05 以降）
   - その facility の通知対象人数（employee: ready/publish 共通、admin: publish 用）
   - その facility×月 に shift_ready/shift_publish 通知が enqueue/sent されたか */
import pg from 'pg';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const client = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:6543, user:`postgres.${m[3]}`, password:decodeURIComponent(m[2]), database:'postgres', ssl:{rejectUnauthorized:false} });
await client.connect();
try {
  // facility × 月 の publish_status (2026-05 以降、単一 status の月のみ正常想定)
  const rows = await client.query(`
    select f.name, sa.facility_id, to_char(sa.date,'YYYY-MM') ym,
           array_agg(distinct sa.publish_status::text) statuses, count(*) n
      from shift_assignments sa join facilities f on f.id=sa.facility_id
     where sa.date >= '2026-05-01'
     group by f.name, sa.facility_id, to_char(sa.date,'YYYY-MM')
     order by ym, f.name`);

  // facility ごとの通知対象人数（active employee, email あり）
  const emp = await client.query(`
    select facility_id, count(*) filter (where role='employee' and status='active' and email is not null) emp_cnt
      from employees group by facility_id`);
  const empMap = new Map(emp.rows.map(r=>[r.facility_id, Number(r.emp_cnt)]));

  // admin 人数（tenant 共通）
  const adminCnt = (await client.query(`select count(*) n from employees where role='admin' and status='active' and email is not null`)).rows[0].n;

  // shift_* 通知が送られた facility×月（meta.year-month）
  const nq = await client.query(`
    select facility_id, (meta->>'year') y, (meta->>'month') mo, content_type, sent_at
      from notification_queue where content_type in ('shift_ready','shift_publish')`);
  const notified = new Set(nq.rows.map(r=>`${r.facility_id}__${String(r.y)}-${String(r.mo).padStart(2,'0')}`));

  console.log('admin 通知対象:', adminCnt, '名\n');
  console.log('=== facility × 月 × publish_status × 通知状況 ===');
  console.table(rows.rows.map(r=>({
    facility: r.name, 月: r.ym, status: r.statuses.join(','), 日数: r.n,
    職員数: empMap.get(r.facility_id) ?? 0,
    通知済み: notified.has(`${r.facility_id}__${r.ym}`) ? 'Y' : '— 未通知',
  })));
} finally { await client.end(); }
