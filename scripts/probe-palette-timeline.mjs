/* パレット6月シフト公開の経緯 + 通知/PWA 状況 */
import pg from 'pg';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const client = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:6543, user:`postgres.${m[3]}`, password:decodeURIComponent(m[2]), database:'postgres', ssl:{rejectUnauthorized:false} });
const PALETTE='cc92a6de-0b33-4bbd-a805-1e8d95865272';
await client.connect();
try {
  // 1. 5月 vs 6月 publish status + created/updated timeline
  console.log('=== パレット shift_assignments 月別 publish_status ===');
  const byMonth = await client.query(`
    select to_char(date,'YYYY-MM') ym, publish_status, count(*) n,
           min(created_at) created_min, max(created_at) created_max
      from shift_assignments where facility_id=$1
      group by 1,2 order by 1,2`, [PALETTE]);
  console.table(byMonth.rows);

  // 2. notification_queue 全体(直近) — enqueue がそもそも機能しているか
  console.log('\n=== notification_queue 直近20件 (全 content_type, tenant=パレットの tenant) ===');
  const nq = await client.query(`
    select content_type, facility_id, scheduled_at, sent_at, cancelled_at, meta
      from notification_queue
      where tenant_id=(select tenant_id from facilities where id=$1)
      order by scheduled_at desc nulls last limit 20`, [PALETTE]);
  console.table(nq.rows.map(r=>({type:r.content_type, fac:(r.facility_id||'').slice(0,8), sched:String(r.scheduled_at).slice(0,16), sent:r.sent_at?'Y':'-', cancelled:r.cancelled_at?'Y':'-', meta:JSON.stringify(r.meta)})));
  const nqCount = await client.query(`select count(*) n from notification_queue where tenant_id=(select tenant_id from facilities where id=$1)`,[PALETTE]);
  console.log('notification_queue 総数(このtenant):', nqCount.rows[0].n);

  // 3. push_subscriptions — パレット職員は PWA Push 登録しているか
  console.log('\n=== push_subscriptions (パレット主所属 employee) ===');
  const ps = await client.query(`
    select count(distinct e.id) emp_with_sub, count(*) total_subs
      from push_subscriptions p join employees e on e.id=p.employee_id
      where e.facility_id=$1`, [PALETTE]);
  console.log(ps.rows[0]);
  const psAll = await client.query(`select count(*) n from push_subscriptions`);
  console.log('push_subscriptions 全体件数:', psAll.rows[0].n);

  // 4. 念のため transport_assignments も
  console.log('\n=== パレット transport_assignments 6月 publish_status ===');
  const ta = await client.query(`
    select publish_status, count(*) n from transport_assignments
      where facility_id=$1 and schedule_entry_id in
        (select id from schedule_entries where facility_id=$1 and date>='2026-06-01' and date<='2026-06-30')
      group by publish_status`, [PALETTE]);
  console.table(ta.rows);
} finally { await client.end(); }
