/* 一時調査: 利用料金表 (billing_summaries) の保存済 attendance_days と
   利用表 (schedule_entries) のライブ出席カウント (isAttended) のズレを突合する。

   isAttended (lib/logic/attendance.ts と完全一致):
     attendance_status !== 'waitlist' AND (pickup_time || dropoff_time)

   保存値が利用表の実回数とどれだけ食い違っているかを件数・金額で可視化する。
   読み取りのみ。DB は一切変更しない。 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const SNACK = 50;
const isAttended = (e) => e.attendance_status !== 'waitlist' && !!(e.pickup_time || e.dropoff_time);
const key = (tenant, fac, child, y, m) => `${tenant}|${fac}|${child}|${Number(y)}|${Number(m)}`;

// facilities 名
const { data: facs } = await sb.from('facilities').select('id, name');
const facName = new Map((facs ?? []).map((f) => [f.id, f.name]));

// 1) billing_summaries 全件（ページング）
const summaries = [];
for (let p = 0; ; p += 1000) {
  const { data, error } = await sb.from('billing_summaries')
    .select('id, tenant_id, facility_id, year, month, child_id, child_name_snapshot, attendance_days, snack_fee, copay_amount, kumon_fee, event_total, total_amount')
    .order('id', { ascending: true }).range(p, p + 999);
  if (error) { console.log('!! billing_summaries error', error.message); process.exit(1); }
  summaries.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
console.log('=== billing_summaries total:', summaries.length, 'rows ===');
if (summaries.length === 0) { console.log('(保存済みサマリなし。ズレ調査の対象なし)'); process.exit(0); }

// 対象年月レンジ（schedule_entries を引く範囲）
const years = summaries.map((s) => Number(s.year));
const minY = Math.min(...years), maxY = Math.max(...years);
const from = `${minY}-01-01`, to = `${maxY}-12-31`;

// 2) schedule_entries を引いて child×facility×year×month の isAttended カウント
const liveCount = new Map();
for (let p = 0; ; p += 1000) {
  const { data, error } = await sb.from('schedule_entries')
    .select('tenant_id, facility_id, child_id, date, pickup_time, dropoff_time, attendance_status')
    .gte('date', from).lte('date', to)
    .order('id', { ascending: true }).range(p, p + 999);
  if (error) { console.log('!! schedule_entries error', error.message); process.exit(1); }
  for (const e of data ?? []) {
    if (!isAttended(e)) continue;
    const k = key(e.tenant_id, e.facility_id, e.child_id, e.date.slice(0, 4), e.date.slice(5, 7));
    liveCount.set(k, (liveCount.get(k) ?? 0) + 1);
  }
  if (!data || data.length < 1000) break;
}

// 3) 突合
let drift = 0, match = 0;
let sumTotalDelta = 0;
const details = [];
for (const s of summaries) {
  const live = liveCount.get(key(s.tenant_id, s.facility_id, s.child_id, s.year, s.month)) ?? 0;
  if (live === s.attendance_days) { match++; continue; }
  drift++;
  const liveSnack = live * SNACK;
  const liveTotal = (s.copay_amount ?? 0) + liveSnack + s.kumon_fee + s.event_total;
  const totalDelta = liveTotal - s.total_amount;
  sumTotalDelta += totalDelta;
  details.push({
    fac: facName.get(s.facility_id) ?? s.facility_id,
    ym: `${s.year}-${String(s.month).padStart(2, '0')}`,
    name: s.child_name_snapshot ?? s.child_id.slice(0, 8),
    saved: s.attendance_days, live,
    savedSnack: s.snack_fee, liveSnack,
    savedTotal: s.total_amount, liveTotal, totalDelta,
  });
}

console.log(`\n=== 突合結果 ===`);
console.log(`  一致: ${match} 件 / ズレ: ${drift} 件`);
console.log(`  ズレ行の請求額 合計差分: ¥${sumTotalDelta.toLocaleString('ja-JP')}（＋＝利用表の方が多い）`);

if (drift > 0) {
  console.log(`\n=== ズレ詳細（最大40件）===`);
  details.sort((a, b) => (a.fac).localeCompare(b.fac) || a.ym.localeCompare(b.ym) || a.name.localeCompare(b.name));
  for (const d of details.slice(0, 40)) {
    console.log(
      `  ${String(d.fac).padEnd(14)} ${d.ym}  ${String(d.name).padEnd(10)} ` +
      `出席 保存=${String(d.saved).padStart(2)}→実=${String(d.live).padStart(2)}  ` +
      `おやつ ¥${String(d.savedSnack).padStart(5)}→¥${String(d.liveSnack).padStart(5)}  ` +
      `請求 ¥${String(d.savedTotal).padStart(6)}→¥${String(d.liveTotal).padStart(6)} (${d.totalDelta >= 0 ? '+' : ''}${d.totalDelta})`,
    );
  }
  if (details.length > 40) console.log(`  … 他 ${details.length - 40} 件`);
}
console.log('\n(done)');
