/* 依頼①調査: 「所属(兼任)を外したのに他施設勤務バッジが残る」真因確認。
   金田竜也 / キムナムユン の 所属(主+兼任) と 6月 shift_assignments を突き合わせ、
   「所属していない施設の勤務データが残っているか」を事実確認する。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const client = createPgClient(env);
await client.connect();
try {
  const who = await client.query(`
    select e.id, e.last_name||' '||e.first_name as name, e.role, e.status, f.name as primary_fac
    from public.employees e left join public.facilities f on f.id=e.facility_id
    where e.last_name like '金%' or e.first_name like '%ナムユン%' or e.last_name like 'キム%'
    order by name`);
  console.log('=== 対象職員 ===');
  console.table(who.rows.map(r=>({name:r.name, role:r.role, status:r.status, primary:r.primary_fac, id:r.id.slice(0,8)})));

  for (const p of who.rows) {
    console.log(`\n----- ${p.name}（主所属 ${p.primary_fac}）-----`);
    const ef = await client.query(`
      select f.name from public.employee_facilities x join public.facilities f on f.id=x.facility_id
      where x.employee_id=$1 order by f.name`, [p.id]);
    console.log('  兼任先:', ef.rows.map(r=>r.name).join(', ') || '(なし)');
    const sa = await client.query(`
      select f.name as work_fac, sa.publish_status,
             count(*) filter (where sa.start_time is not null) as 時間あり行,
             count(*) as 総行
      from public.shift_assignments sa join public.facilities f on f.id=sa.facility_id
      where sa.employee_id=$1 and to_char(sa.date,'YYYY-MM')='2026-06'
      group by 1,2 order by 1,2`, [p.id]);
    console.log('  6月 shift_assignments:');
    console.table(sa.rows);
    // 「主所属でも兼任でもない施設」に時間あり勤務が残っているか＝バッジが残る原因
    const belongs = new Set([p.primary_fac, ...ef.rows.map(r=>r.name)]);
    const orphan = sa.rows.filter(r => Number(r['時間あり行'])>0 && !belongs.has(r.work_fac));
    if (orphan.length) console.log('  ⚠ 所属外なのに時間あり勤務が残る施設:', orphan.map(r=>`${r.work_fac}(${r['時間あり行']}行/${r.publish_status})`).join(', '));
    else console.log('  ✅ 所属外の残存勤務なし');
  }
} catch (e) {
  console.log('probe error:', e.message);
} finally { await client.end(); }
