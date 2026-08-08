/* Phase A の検証: BillingFull.tsx の participations 初期化を旧実装/新実装で再現し、
   実 DB のデータに対して「何がどう変わるか」を突き合わせる。

   旧: existing ? (partsMap.get(ev.id) ?? false) : attended
   新: (existing && partsMap.has(ev.id)) ? partsMap.get(ev.id) : attended

   確認したいこと:
     1. 補完 (OFF → ON) が起きるのは「保存済みなのに participations 行が無い」セルだけか
     2. 保存済みの明示値 (true/false) が 1 件も書き換わっていないか  ← 最重要
     3. 新実装で残るズレ (= 画面に ⚠ / ＋ が出る件数) はいくつか
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

/* lib/logic/attendance.ts の isAttended と完全一致させる */
const isAttended = (e) => e.attendance_status !== 'waitlist' && !!(e.pickup_time || e.dropoff_time);

/** PostgREST の既定上限 1000 行を越えるテーブルは必ずページングする */
async function fetchAll(table, columns, orderCol) {
  const out = [];
  for (let p = 0; ; p += 1000) {
    const { data, error } = await sb.from(table).select(columns)
      .order(orderCol, { ascending: true }).range(p, p + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const { data: facs } = await sb.from('facilities').select('id, name');
const facName = new Map((facs ?? []).map((f) => [f.id, f.name]));

const events = await fetchAll('events', 'id, tenant_id, facility_id, date, name, price', 'date');
const summaries = await fetchAll(
  'billing_summaries',
  'id, tenant_id, facility_id, year, month, child_id, child_name_snapshot',
  'id',
);
const parts = await fetchAll(
  'billing_event_participations',
  'billing_summary_id, event_id, participated',
  'billing_summary_id',
);
const entries = await fetchAll(
  'schedule_entries',
  'child_id, facility_id, date, pickup_time, dropoff_time, attendance_status',
  'date',
);

const attended = new Set(entries.filter(isAttended).map((e) => `${e.child_id}|${e.date}`));
const partsBySummary = new Map();
for (const p of parts) {
  if (!partsBySummary.has(p.billing_summary_id)) partsBySummary.set(p.billing_summary_id, new Map());
  partsBySummary.get(p.billing_summary_id).set(p.event_id, p.participated);
}

/* 画面と同じ単位（facility × year × month）でイベント列を組む */
const eventsByFacMonth = new Map();
for (const ev of events) {
  const k = `${ev.facility_id}|${Number(ev.date.slice(0, 4))}|${Number(ev.date.slice(5, 7))}`;
  if (!eventsByFacMonth.has(k)) eventsByFacMonth.set(k, []);
  eventsByFacMonth.get(k).push(ev);
}

let cells = 0;
let filled = 0;              // 新実装で出席実績から補完されたセル
let filledOn = 0;            // うち OFF → ON になったもの（請求漏れの解消）
let savedValueChanged = 0;   // 保存済みの明示値が書き換わったセル（0 でなければ設計違反）
let driftOld = 0;
let driftNew = 0;
const dirtyRowsBefore = new Set();
const byMonth = new Map();

for (const s of summaries) {
  const evs = eventsByFacMonth.get(`${s.facility_id}|${s.year}|${s.month}`) ?? [];
  const partsMap = partsBySummary.get(s.id) ?? new Map();
  const mk = `${facName.get(s.facility_id) ?? s.facility_id} ${s.year}-${String(s.month).padStart(2, '0')}`;
  if (!byMonth.has(mk)) byMonth.set(mk, { filled: 0, filledOn: 0, driftNew: 0 });
  const agg = byMonth.get(mk);

  for (const ev of evs) {
    cells++;
    const att = attended.has(`${s.child_id}|${ev.date}`);
    const oldVal = partsMap.get(ev.id) ?? false;                     // 旧実装
    const hasRow = partsMap.has(ev.id);
    const newVal = hasRow ? partsMap.get(ev.id) : att;               // 新実装

    if (!hasRow) {
      filled++; agg.filled++;
      if (newVal === true) { filledOn++; agg.filledOn++; }
      dirtyRowsBefore.add(s.id);
    } else if (newVal !== oldVal) {
      /* 行が存在するのに値が変わったら設計違反（保存済みを勝手に書き換えている） */
      savedValueChanged++;
      console.log(`  !! 保存済みの値が変化: ${s.child_name_snapshot} / ${ev.date} ${ev.name}`);
    }

    if (oldVal !== att) driftOld++;
    if (newVal !== att) { driftNew++; agg.driftNew++; }
  }
}

console.log('=== Phase A シミュレーション（実 DB データ）===');
console.log(`対象セル (保存済みサマリ × 当月イベント): ${cells}`);
console.log('');
console.log(`1) 出席実績から補完されたセル      : ${filled}  （participations 行が無かった分）`);
console.log(`   うち OFF → ON（請求漏れ解消）  : ${filledOn}`);
console.log(`2) 保存済みの明示値が変化したセル  : ${savedValueChanged}  ${savedValueChanged === 0 ? '✅ 期待どおり 0' : '❌ 設計違反'}`);
console.log('');
console.log(`3) 画面に出るズレ件数（旧実装）    : ${driftOld}`);
console.log(`   画面に出るズレ件数（新実装）    : ${driftNew}  ← ⚠ / ＋ が出る数`);
console.log(`   補完により解消したズレ          : ${driftOld - driftNew}`);
console.log('');
console.log(`4) 補完により dirty になる行数     : ${dirtyRowsBefore.size} / ${summaries.length}（「保存」を押すと永続化される）`);
console.log('');
console.log('=== 月別内訳（補完あり or ズレありの月のみ）===');
for (const [k, v] of [...byMonth].sort()) {
  if (v.filled === 0 && v.driftNew === 0) continue;
  console.log(`  ${k}: 補完 ${v.filled}（うちON ${v.filledOn}） / 残ズレ ${v.driftNew}`);
}
