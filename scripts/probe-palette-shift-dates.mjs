/* 「社員画面でパレットのシフトが日付途中までしか出ない」調査。
   施設シフトタブ(MyFacilityShiftView)と同じ条件で、日付ごとの行数 + publish_status を出す。
   - 途中の日付で件数が 0 / draft に切り替わっていれば「部分公開」が原因
   - 全日 published なのに UI が途中までなら row-cap / 描画の問題 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PALETTE = 'cc92a6de-0b33-4bbd-a805-1e8d95865272';

for (const ym of ['2026-06', '2026-07']) {
  const from = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(lastDay).padStart(2,'0')}`;

  // service role（RLS なし）で全件
  const { data: all, error } = await sb.from('shift_assignments')
    .select('date, publish_status')
    .eq('facility_id', PALETTE).gte('date', from).lte('date', to);
  if (error) { console.log(ym, 'error:', error.message); continue; }

  const byDate = {};
  const byStatus = {};
  for (const r of all ?? []) {
    byDate[r.date] = byDate[r.date] || { published: 0, ready: 0, draft: 0 };
    byDate[r.date][r.publish_status] = (byDate[r.date][r.publish_status] ?? 0) + 1;
    byStatus[r.publish_status] = (byStatus[r.publish_status] ?? 0) + 1;
  }
  const dates = Object.keys(byDate).sort();
  console.log(`\n=== ${ym} パレット（service role 全件）===`);
  console.log('総件数:', (all ?? []).length, '| status分布:', byStatus);
  console.log('日付範囲:', dates[0], '...', dates[dates.length-1], `(${dates.length} 日に何かしらある / 月は${lastDay}日)`);
  // 公開のある最初/最後の日
  const pubDates = dates.filter(d => byDate[d].published > 0);
  if (pubDates.length) console.log('published のある日:', pubDates[0], '...', pubDates[pubDates.length-1], `(${pubDates.length}日)`);
  // 後半に published が無い日があるか（=部分公開の疑い）
  const missing = dates.filter(d => byDate[d].published === 0);
  if (missing.length) console.log('⚠ published 0 の日（draft/ready のみ）:', missing.slice(0,40).join(', '));
}

// row-cap 検証: 大量 select して 1000 でちょうど止まらないか
const { data: big } = await sb.from('shift_assignments').select('id').eq('facility_id', PALETTE);
console.log('\n=== row-cap 検証 ===');
console.log('パレット shift_assignments 総数(service role):', (big ?? []).length, big && big.length === 1000 ? '⚠ ちょうど1000 = 上限の疑い' : '(1000未満 = 上限ではない)');
