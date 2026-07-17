/* 既に「公開済み」だが通知が飛んでいない 2026-06 シフトについて、
   shift_publish 通知を enqueue する（pg_cron が新コードで配信 → 職員 + admin）。
   対象: 職員のいる 3 施設のみ（パレット / パステル / パズル）。本部(職員0)は除外。
   二重防止: 既存の未送信 shift_publish(同 facility/2026-06) を delete してから insert。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const client = createPgClient(env);

const TARGETS = ['cc92a6de-0b33-4bbd-a805-1e8d95865272', // パレット
                 '38964f31-8d28-4c49-a3b5-aa7c9ff87683', // パステル
                 '3baea499-7a8e-4892-a091-493373a29f73']; // パズル
const YEAR = 2026, MONTH = 6;

await client.connect();
try {
  for (const fid of TARGETS) {
    const f = await client.query(`select name, tenant_id from facilities where id=$1`, [fid]);
    if (f.rows.length === 0) { console.log('!! facility 不明', fid); continue; }
    const { name, tenant_id } = f.rows[0];

    // 公開済みであることを再確認（誤送信防止）
    const pub = await client.query(
      `select count(*) n from shift_assignments
        where facility_id=$1 and publish_status='published'
          and date >= $2 and date < $3`,
      [fid, `${YEAR}-${String(MONTH).padStart(2,'0')}-01`, `${YEAR}-${String(MONTH===12?MONTH:MONTH+1).padStart(2,'0')}-01`]);
    if (Number(pub.rows[0].n) === 0) { console.log(`skip ${name}: 公開済みシフトなし`); continue; }

    // 二重防止
    await client.query(
      `delete from notification_queue
        where facility_id=$1 and content_type='shift_publish'
          and sent_at is null and cancelled_at is null
          and meta->>'year'=$2 and meta->>'month'=$3`,
      [fid, String(YEAR), String(MONTH)]);

    await client.query(
      `insert into notification_queue
         (tenant_id, facility_id, content_type, content_id, meta, scheduled_at, first_scheduled_at, created_by)
       values ($1, $2, 'shift_publish', null, $3::jsonb, now(), now(), null)`,
      [tenant_id, fid, JSON.stringify({ year: YEAR, month: MONTH, kind: 'shift_publish' })]);
    console.log(`enqueued: ${name} (${YEAR}-${MONTH}) published=${pub.rows[0].n}日`);
  }

  console.log('\n=== enqueue 後の shift_publish キュー ===');
  const q = await client.query(`
    select f.name, nq.scheduled_at, nq.sent_at, nq.cancelled_at
      from notification_queue nq join facilities f on f.id=nq.facility_id
     where nq.content_type='shift_publish' and nq.meta->>'year'='2026' and nq.meta->>'month'='6'
     order by f.name`);
  console.table(q.rows.map(r=>({facility:r.name, sched:String(r.scheduled_at).slice(0,19), sent:r.sent_at?'Y':'pending', cancelled:r.cancelled_at?'Y':'-'})));
} finally { await client.end(); }
