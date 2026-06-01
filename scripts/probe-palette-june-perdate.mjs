import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const P = 'cc92a6de-0b33-4bbd-a805-1e8d95865272';

const { data } = await sb.from('shift_assignments')
  .select('date, assignment_type, employee_id, start_time')
  .eq('facility_id', P).eq('publish_status', 'published')
  .gte('date', '2026-06-01').lte('date', '2026-06-30');

const rows = data ?? [];
const byType = {};
for (const x of rows) byType[x.assignment_type] = (byType[x.assignment_type] ?? 0) + 1;
console.log('TOTAL published June rows:', rows.length, '| by type:', byType);

let early = 0, late = 0;
for (const x of rows) (Number(x.date.slice(8)) <= 11 ? early++ : late++);
console.log('day 1-11 rows:', early, '| day 12-30 rows:', late);

console.log('\nper-date (type counts):');
for (let d = 1; d <= 30; d++) {
  const k = `2026-06-${String(d).padStart(2,'0')}`;
  const dayRows = rows.filter((x) => x.date === k);
  const t = {};
  for (const x of dayRows) t[x.assignment_type] = (t[x.assignment_type] ?? 0) + 1;
  console.log(`  ${String(d).padStart(2)}日: ${dayRows.length} 件  ${JSON.stringify(t)}`);
}
console.log('\ndistinct employees in published June:', new Set(rows.map((x) => x.employee_id)).size);
