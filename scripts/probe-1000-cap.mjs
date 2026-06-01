/* 仮説検証: MyFacilityShiftView の shift_assignments クエリが
   兼務(facIds 複数施設) で 1000 行を超え、PostgREST のデフォルト max-rows(1000) で
   黙って打ち切られて「途中まで」表示になっているか。
   - PostgREST REST に Prefer: count=exact で投げ、返り行数 vs 実 count を比較
   - facIds = [palette], [palette+pastel+puzzle] の両方で確認
   - employees クエリ側の行数も確認
   service role でも PostgREST の max-rows は返却件数に効く（count は真値が返る）。 */
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const PALETTE = 'cc92a6de-0b33-4bbd-a805-1e8d95865272';
const PASTEL  = '38964f31-8d28-4c49-a3b5-aa7c9ff87683';
const PUZZLE  = '3baea499-7a8e-4892-a091-493373a29f73';

async function rest(p) {
  const r = await fetch(`${BASE}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' } });
  const cr = r.headers.get('content-range'); // "0-999/1052"
  const body = await r.json().catch(() => []);
  const total = cr && cr.includes('/') ? cr.split('/')[1] : '?';
  return { status: r.status, returned: Array.isArray(body) ? body.length : 0, total, contentRange: cr };
}

const facCsv = (ids) => `(${ids.join(',')})`;
const FROM = '2026-06-01', TO = '2026-06-30';

console.log('=== shift_assignments クエリ (MyFacilityShiftView と同条件) ===');
for (const [label, ids] of [['palette のみ', [PALETTE]], ['palette+pastel+puzzle (兼務想定)', [PALETTE, PASTEL, PUZZLE]]]) {
  const q = `shift_assignments?select=employee_id,facility_id,date,start_time,end_time,assignment_type,note,publish_status&facility_id=in.${facCsv(ids)}&publish_status=in.(ready,published)&date=gte.${FROM}&date=lte.${TO}`;
  const res = await rest(q);
  const capped = res.total !== '?' && Number(res.total) > res.returned;
  console.log(`\n[${label}]`);
  console.log(`  実 count(content-range): ${res.total} / 返却された行数: ${res.returned}  ${capped ? '⚠ 打ち切り発生!（'+(res.total-res.returned)+'行 欠落）' : 'OK（全件返却）'}`);
}

console.log('\n=== employees クエリ (同条件) ===');
for (const [label, ids] of [['palette のみ', [PALETTE]], ['palette+pastel+puzzle', [PALETTE, PASTEL, PUZZLE]]]) {
  const q = `employees?select=id,last_name,first_name,facility_id&status=eq.active&facility_id=in.${facCsv(ids)}`;
  const res = await rest(q);
  console.log(`  [${label}] active employees: count=${res.total} / 返却=${res.returned}`);
}

console.log('\n=== PostgREST のデフォルト max-rows を直接確認 (limit 無しで全 shift) ===');
const all = await rest(`shift_assignments?select=id`);
console.log(`  shift_assignments 全件: count=${all.total} / 返却=${all.returned}  ${all.returned === 1000 ? '→ max-rows=1000 で打ち切り確定' : ''}`);
