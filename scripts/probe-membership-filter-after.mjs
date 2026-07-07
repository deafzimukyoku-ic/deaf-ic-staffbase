/* ①修正の効果確認: 新フィルタ「現所属(主+兼任)の施設の勤務だけをバッジ化」を
   アプリと同じロジックで再現し、金田さんのパステル残存が除外されることを示す。 */
import pg from 'pg';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const client = new pg.Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:6543, user:`postgres.${m[3]}`, password:decodeURIComponent(m[2]), database:'postgres', ssl:{rejectUnauthorized:false} });
await client.connect();
try {
  const emp = await client.query(`select id, last_name||' '||first_name name, facility_id from public.employees where last_name like '金田%' limit 1`);
  const e = emp.rows[0];
  const ef = await client.query(`select facility_id from public.employee_facilities where employee_id=$1`, [e.id]);
  const belongs = new Set([e.facility_id, ...ef.rows.map(r=>r.facility_id)]);
  const cross = await client.query(`
    select f.name, sa.facility_id, count(*) filter (where sa.start_time is not null) n
    from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id
    where sa.employee_id=$1 and to_char(sa.date,'YYYY-MM')='2026-06' and sa.facility_id<>$2
    group by 1,2`, [e.id, e.facility_id]);
  console.log(`${e.name}: 現所属(主+兼任) facility 数 = ${belongs.size}`);
  for (const r of cross.rows) {
    const shown = belongs.has(r.facility_id);
    console.log(`  他施設「${r.name}」の時間あり勤務 ${r.n}件 → 修正後バッジ: ${shown ? '表示（所属あり）' : '❌非表示（所属を外したので消える）'}`);
  }
} finally { await client.end(); }
