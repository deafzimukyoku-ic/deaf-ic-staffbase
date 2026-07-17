/* 先方要望④(日ごとの勤務先) 調査用 probe:
   - facilities のシフト系フラグ (本部がシフト運用しているか)
   - employee_facilities (兼任) の登録実態
   - admin ロール職員の主所属
   - 兼任職員の他施設 shift_assignments 件数 (相互反映の実データ有無) */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const client = createPgClient(env);
await client.connect();
try {
  console.log('=== facilities (シフト系フラグ) ===');
  const fac = await client.query(`
    select name, shift_enabled, transport_enabled, shift_only_mode
    from public.facilities order by created_at`);
  console.table(fac.rows);

  console.log('\n=== admin / manager ロール職員の主所属 ===');
  const admins = await client.query(`
    select e.last_name || ' ' || e.first_name as name, e.role, e.employment_type, f.name as primary_facility, e.status
    from public.employees e left join public.facilities f on f.id = e.facility_id
    where e.role in ('admin','manager') order by e.role, f.name`);
  console.table(admins.rows);

  console.log('\n=== employee_facilities (兼任登録) ===');
  const ef = await client.query(`
    select e.last_name || ' ' || e.first_name as name, e.role, fp.name as primary_fac, fx.name as additional_fac
    from public.employee_facilities x
    join public.employees e on e.id = x.employee_id
    left join public.facilities fp on fp.id = e.facility_id
    join public.facilities fx on fx.id = x.facility_id
    order by name`);
  console.table(ef.rows.length ? ef.rows : [{info:'兼任登録なし'}]);

  console.log('\n=== 兼任職員の「主所属以外の施設」での shift_assignments 件数 (月別/施設別/状態別) ===');
  const cross = await client.query(`
    select e.last_name || ' ' || e.first_name as name,
           f.name as work_facility, to_char(sa.date,'YYYY-MM') as month,
           sa.publish_status, count(*) filter (where sa.assignment_type in ('normal','am_off','pm_off')) as working_rows,
           count(*) as total_rows
    from public.shift_assignments sa
    join public.employees e on e.id = sa.employee_id
    join public.facilities f on f.id = sa.facility_id
    where sa.facility_id is distinct from e.facility_id
    group by 1,2,3,4 order by 3 desc, 1 limit 20`);
  console.table(cross.rows.length ? cross.rows : [{info:'他施設 assignment なし'}]);
} catch (e) {
  console.log('probe error:', e.message);
} finally { await client.end(); }
