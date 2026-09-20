/* 送迎割当の取得が PostgREST の max-rows(1000) で打ち切られないことの検証（2026-09-20 の本番バグ）。
   実装したヘルパー本体（lib/api/transportAssignments.ts）を **そのまま import して実行**する
   （.mjs に書き写すと写し間違いを検証できないため）。
   実行: node --experimental-strip-types --import ./scripts/_register-alias.mjs scripts/verify-transport-fetch.ts */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fetchTransportAssignments } from '@/lib/api/transportAssignments';
import { fetchAllRows } from '@/lib/multi-facility';
import type { TransportAssignmentRow } from '@/lib/types';

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(import.meta.dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#')).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PUZZLE = '3baea499-7a8e-4892-a091-493373a29f73';

const month = await fetchTransportAssignments(supabase, PUZZLE, '2026-10-01', '2026-10-31');
const day = await fetchTransportAssignments(supabase, PUZZLE, '2026-10-07', '2026-10-07');
console.log(`送迎表(10月) 取得: ${month.length} 行`);
console.log(`日次出力(10/7) 取得: ${day.length} 行 / 担当入り: ${day.filter((t) => t.pickup_employee_ids.length + t.dropoff_employee_ids.length > 0).length} 件`);
console.log(`埋め込みキー除去: ${Object.keys(day[0] ?? {}).includes('schedule_entries') ? '❌ 残っている' : '✅ 剥がれている'}`);
console.log('キー:', Object.keys(day[0] ?? {}).join(', '));

/* ページング境界の検証: 小さい pageSize でも「重複なし・取りこぼしなし」で同じ集合が取れるか。
   （order('id') を外すとここが割れる = 並び固定が効いていることの確認） */
const build = () =>
  supabase
    .from('transport_assignments')
    .select('*, schedule_entries!inner(date)')
    .eq('facility_id', PUZZLE)
    .gte('schedule_entries.date', '2026-10-01')
    .lte('schedule_entries.date', '2026-10-31')
    .order('id', { ascending: true });

for (const pageSize of [7, 230, 1000]) {
  const paged = await fetchAllRows<TransportAssignmentRow>(build, pageSize);
  const ids = new Set(paged.map((r) => r.id));
  console.log(
    `pageSize=${String(pageSize).padStart(4)}: ${paged.length} 行 / ユニーク ${ids.size} 件 ` +
      `${paged.length === month.length && ids.size === month.length ? '✅ 一致' : '❌ ズレ'}`,
  );
}
