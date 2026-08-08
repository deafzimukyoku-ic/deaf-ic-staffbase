/* 一時調査: 利用料金表の「イベント × 氏名」交差セルのチェック状態を実 DB から確認する。
   目的:
     ① 利用表(schedule_entries)に出席実績が入っている児童 × 当日イベント の交差セルが
        チェック済み(participated=true)になっているか。保存済み月でズレていないか。
     - 未保存月は画面ロジックが出席から初期値を作るので、DB には行が無いのが正常。
     - 保存済み月で「出席あり × participated=false」が出るなら、保存後に利用表を直しても
       チェックが追従しない（＝コードどおりの挙動）ことの実証になる。
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

const isAttended = (e) => e.attendance_status !== 'waitlist' && !!(e.pickup_time || e.dropoff_time);

const { data: facs } = await sb.from('facilities').select('id, name');
const facName = new Map((facs ?? []).map((f) => [f.id, f.name]));

const { data: events } = await sb.from('events')
  .select('id, tenant_id, facility_id, date, name, price').order('date');
console.log('=== events:', (events ?? []).length, '件 ===');
for (const e of events ?? []) {
  console.log(`  ${e.date} ${facName.get(e.facility_id) ?? e.facility_id} / ${e.name} / ¥${e.price}`);
}

const { data: summaries } = await sb.from('billing_summaries')
  .select('id, tenant_id, facility_id, year, month, child_id, child_name_snapshot, attendance_days, snack_fee, snack_fee_override, kumon_fee, event_total, total_amount, received_at');
console.log('\n=== billing_summaries:', (summaries ?? []).length, '件 ===');
const byMonth = new Map();
for (const s of summaries ?? []) {
  const k = `${facName.get(s.facility_id) ?? s.facility_id} ${s.year}-${String(s.month).padStart(2, '0')}`;
  byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
}
for (const [k, v] of [...byMonth].sort()) console.log(`  ${k}: ${v}行`);

/* PostgREST の既定上限は 1000 行。ページングしないと件数を誤読して誤診する。 */
const parts = [];
for (let p = 0; ; p += 1000) {
  const { data, error } = await sb.from('billing_event_participations')
    .select('billing_summary_id, event_id, participated, amount')
    .order('billing_summary_id', { ascending: true }).order('event_id', { ascending: true })
    .range(p, p + 999);
  if (error) { console.log('!! participations error', error.message); break; }
  parts.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
console.log('\n=== billing_event_participations:', (parts ?? []).length, '件 / participated=true:',
  (parts ?? []).filter((p) => p.participated).length, '===');

/* イベント日の出席実績 vs 保存済みチェックの突合 */
const evById = new Map((events ?? []).map((e) => [e.id, e]));
const sumById = new Map((summaries ?? []).map((s) => [s.id, s]));
const evDates = [...new Set((events ?? []).map((e) => e.date))];
if (evDates.length > 0) {
  const { data: entries } = await sb.from('schedule_entries')
    .select('child_id, facility_id, date, pickup_time, dropoff_time, attendance_status')
    .in('date', evDates);
  const attended = new Set(
    (entries ?? []).filter(isAttended).map((e) => `${e.child_id}|${e.date}`)
  );
  console.log('\n=== イベント日の出席実績 vs 保存済みチェック ===');
  let mismatchOnOff = 0, mismatchOffOn = 0, match = 0;
  for (const p of parts ?? []) {
    const s = sumById.get(p.billing_summary_id);
    const ev = evById.get(p.event_id);
    if (!s || !ev) continue;
    const wasAttended = attended.has(`${s.child_id}|${ev.date}`);
    if (wasAttended === p.participated) { match++; continue; }
    if (wasAttended && !p.participated) {
      mismatchOnOff++;
      console.log(`  [出席あり×チェックOFF] ${s.child_name_snapshot} / ${ev.date} ${ev.name} ¥${ev.price}`);
    } else {
      mismatchOffOn++;
      console.log(`  [出席なし×チェックON ] ${s.child_name_snapshot} / ${ev.date} ${ev.name} ¥${ev.price}`);
    }
  }
  console.log(`  一致:${match} / 出席ありなのにOFF:${mismatchOnOff} / 出席なしなのにON:${mismatchOffOn}`);

  /* 保存済みサマリなのに participations 行が存在しないイベント（＝保存後にイベント追加された痕跡） */
  console.log('\n=== 保存済みサマリに participations 行が無い (summary, event) ===');
  const haveKey = new Set((parts ?? []).map((p) => `${p.billing_summary_id}|${p.event_id}`));
  let missing = 0;
  for (const s of summaries ?? []) {
    for (const ev of events ?? []) {
      if (ev.facility_id !== s.facility_id) continue;
      const [y, m] = [Number(ev.date.slice(0, 4)), Number(ev.date.slice(5, 7))];
      if (y !== s.year || m !== s.month) continue;
      if (!haveKey.has(`${s.id}|${ev.id}`)) {
        missing++;
        const wasAttended = attended.has(`${s.child_id}|${ev.date}`);
        console.log(`  ${s.child_name_snapshot} / ${ev.date} ${ev.name} (出席実績: ${wasAttended ? 'あり' : 'なし'})`);
      }
    }
  }
  console.log(`  欠落: ${missing}件`);
}

/* snack_fee_override 列が実在するか（migration 221 の適用確認） */
const { error: colErr } = await sb.from('billing_summaries').select('snack_fee_override').limit(1);
console.log('\n=== migration 221 (snack_fee_override) 適用:', colErr ? `未適用/エラー ${colErr.message}` : '適用済み', '===');

/* children の料金関連列 */
const { data: kids, error: kidErr } = await sb.from('children')
  .select('id, name, facility_id, municipality, copay_tier, copay_freeform_amount, kumon_monthly_fee, is_active')
  .eq('is_active', true);
console.log('\n=== children (active):', (kids ?? []).length, '件 ===', kidErr?.message ?? '');
const tierCount = {};
for (const k of kids ?? []) tierCount[k.copay_tier ?? 'null'] = (tierCount[k.copay_tier ?? 'null'] ?? 0) + 1;
console.log('  copay_tier 分布:', JSON.stringify(tierCount));
console.log('  kumon_monthly_fee あり:', (kids ?? []).filter((k) => k.kumon_monthly_fee > 0).length, '件');

/* 同姓の児童（兄弟候補）を facility ごとに */
/* 氏名にスペース区切りが無いため、先頭2文字/3文字の一致で兄弟候補を推定する（あくまで目安）。 */
console.log('\n=== 同姓（兄弟候補）の児童 ===');
for (const len of [3, 2]) {
  const byFacSurname = new Map();
  for (const k of kids ?? []) {
    const surname = (k.name ?? '').replace(/[\s　]/g, '').slice(0, len);
    if (surname.length < len) continue;
    const key = `${k.facility_id}|${surname}`;
    if (!byFacSurname.has(key)) byFacSurname.set(key, []);
    byFacSurname.get(key).push(k.name);
  }
  const hits = [...byFacSurname].filter(([, names]) => names.length >= 2);
  console.log(`  --- 先頭${len}文字一致: ${hits.length}組 ---`);
  for (const [key, names] of hits) {
    const [fid, surname] = key.split('|');
    console.log(`    ${facName.get(fid) ?? fid} / ${surname}: ${names.join(', ')}`);
  }
}
