/* smart-default のクエリ上限 `${nextMonth}-31` が無効日付でエラーになるか確認。
   フロントと同じ supabase-js (PostgREST) で再現する。 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PALETTE = 'cc92a6de-0b33-4bbd-a805-1e8d95865272';

console.log('=== ❌ 現状(バグ): 上限 2026-06-31 ===');
const bad = await sb.from('shift_assignments').select('date')
  .in('facility_id', [PALETTE]).eq('publish_status', 'published')
  .gte('date', '2026-04-01').lte('date', '2026-06-31');
console.log('error:', bad.error?.message ?? 'なし', '| rows:', (bad.data ?? []).length);

console.log('\n=== ✅ 修正案: 上限を排他境界 2026-07-01 (lt) ===');
const good = await sb.from('shift_assignments').select('date')
  .in('facility_id', [PALETTE]).eq('publish_status', 'published')
  .gte('date', '2026-04-01').lt('date', '2026-07-01');
const months = new Set((good.data ?? []).map(r => r.date.slice(0, 7)));
console.log('error:', good.error?.message ?? 'なし', '| rows:', (good.data ?? []).length, '| 公開済み月:', [...months].sort());
const preferred = ['2026-06','2026-05','2026-04'].find(mm => months.has(mm));
console.log('→ smartDefault 採用月:', preferred);
