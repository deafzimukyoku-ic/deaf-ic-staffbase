/* notification dispatch が Supabase pg_cron で実際に動いているか確認。
   動いていれば GitHub Actions の notification-cron.yml は安全に削除できる。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const client = createPgClient(env);
await client.connect();
try {
  console.log('=== cron 拡張 ===');
  const ext = await client.query(`select extname from pg_extension where extname in ('pg_cron','pg_net') order by extname`);
  console.log(ext.rows.map(r=>r.extname).join(', ') || '(なし)');

  console.log('\n=== cron.job 一覧 ===');
  const jobs = await client.query(`select jobid, schedule, active, left(command, 90) cmd from cron.job order by jobid`);
  console.table(jobs.rows);

  console.log('\n=== 直近の実行履歴 (send-notifications 関連 job) ===');
  const runs = await client.query(`
    select j.jobname, r.status, r.start_time, left(coalesce(r.return_message,''),60) msg
    from cron.job_run_details r join cron.job j on j.jobid=r.jobid
    where j.command ilike '%send-notifications%' or j.jobname ilike '%notif%'
    order by r.start_time desc limit 8`);
  console.table(runs.rows.map(r=>({job:r.jobname, status:r.status, at:String(r.start_time).slice(0,19), msg:r.msg})));
} catch (e) {
  console.log('probe error:', e.message);
} finally { await client.end(); }
