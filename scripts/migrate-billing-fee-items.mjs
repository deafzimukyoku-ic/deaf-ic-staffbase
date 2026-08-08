/* 請求項目マスタへのデータ移行（docs/features/billing-configurable-items.md §4）
 *
 *   1. 事業所ごとに組込項目をシード
 *        おやつ等   : per_day           unit=SNACK_FEE_PER_DAY(50)  system_key='snack'
 *        教材印刷代 : per_child_monthly                             system_key='material'
 *        他施設利用 : checkbox          unit=0（金額は職員が設定）  system_key='other_facility'
 *   2. children.kumon_monthly_fee (>0) → children_fee_amounts(material)
 *   3. billing_summaries → billing_summary_fee_amounts
 *        snack   : amount=snack_fee,  amount_override=snack_fee_override
 *        material: amount=kumon_fee,  amount_override=null
 *   4. 検証: 全 billing_summaries について「移行前のライブ算出」と「移行後のライブ算出」が
 *      1 円も違わないことを実データ（schedule_entries の出席日数）で突き合わせる。
 *
 * 既定は dry-run（何も書かない）。実行するには --apply を付ける。
 * unique 制約 + upsert により冪等（再実行しても重複シード・二重計上は起きない）。
 *
 * 接続は constraints.md §2 に従い pooler 経由（証明書検証あり）。 */
import { createPgClient } from './_db.mjs';

const APPLY = process.argv.includes('--apply');
const SNACK_FEE_PER_DAY = 50; // lib/constants.ts と同値。ここを変えるとシード単価が変わる

/* lib/logic/attendance.ts の isAttended と完全一致させる */
const isAttended = (e) => e.attendance_status !== 'waitlist' && !!(e.pickup_time || e.dropoff_time);

/* 移行前のライブ算出（現行 BillingFull.tsx / computeBilling.ts の式） */
const oldSnack = (days, override) =>
  override == null ? Math.max(0, days) * SNACK_FEE_PER_DAY : Math.max(0, Math.floor(override));
const oldKumon = (kumonMonthlyFee) =>
  kumonMonthlyFee != null && kumonMonthlyFee > 0 ? Math.floor(kumonMonthlyFee) : 0;

/* 移行後のライブ算出（lib/logic/computeBilling.ts resolveFeeAmount と同じ規則） */
const newFee = (calcType, unitAmount, { checked, amountOverride, childAmount }, days) => {
  switch (calcType) {
    case 'per_day': return amountOverride ?? Math.max(0, days) * unitAmount;
    case 'per_child_monthly': return amountOverride ?? childAmount ?? 0;
    case 'monthly_fixed': return amountOverride ?? unitAmount;
    case 'checkbox': return checked ? (amountOverride ?? unitAmount) : 0;
    default: return 0;
  }
};

const client = createPgClient();
await client.connect();
try {
  console.log(APPLY ? '=== APPLY モード（DB を変更します）===' : '=== DRY-RUN（DB は変更しません。--apply で実行）===\n');

  const { rows: facilities } = await client.query(
    `select id, tenant_id, name from public.facilities order by name`);
  console.log(`対象事業所: ${facilities.length} 件\n`);

  if (APPLY) await client.query('BEGIN');

  /* ---------- 1. 組込項目のシード ---------- */
  const SEEDS = [
    { key: 'snack', name: 'おやつ等', calc: 'per_day', unit: SNACK_FEE_PER_DAY, step: SNACK_FEE_PER_DAY, order: 10 },
    { key: 'material', name: '教材印刷代', calc: 'per_child_monthly', unit: 0, step: null, order: 20 },
    /* 他施設利用は金額未設定(0)で有効化。列は最初から出るので、
       職員は請求項目設定で金額を入れるだけでよい（設定ページで「金額未設定」を警告表示する）。 */
    { key: 'other_facility', name: '他施設利用', calc: 'checkbox', unit: 0, step: null, order: 30 },
  ];
  const itemIdByFacKey = new Map();
  let seeded = 0, seedExisting = 0;
  for (const f of facilities) {
    for (const s of SEEDS) {
      const { rows: found } = await client.query(
        `select id, name, calc_type, unit_amount from public.billing_fee_items
          where tenant_id=$1 and facility_id=$2 and system_key=$3`, [f.tenant_id, f.id, s.key]);
      if (found[0]) {
        itemIdByFacKey.set(`${f.id}|${s.key}`, found[0].id);
        seedExisting++;
        continue;
      }
      if (APPLY) {
        const { rows: ins } = await client.query(`
          insert into public.billing_fee_items
            (tenant_id, facility_id, name, calc_type, unit_amount, step_amount, system_key, display_order)
          values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [f.tenant_id, f.id, s.name, s.calc, s.unit, s.step, s.key, s.order]);
        itemIdByFacKey.set(`${f.id}|${s.key}`, ins[0].id);
      } else {
        itemIdByFacKey.set(`${f.id}|${s.key}`, `(dry-run:${f.id}:${s.key})`);
      }
      seeded++;
      console.log(`  + ${f.name} / ${s.name} (${s.calc}, unit=${s.unit})`);
    }
  }
  console.log(`\n1) 項目シード: 新規 ${seeded} / 既存 ${seedExisting}\n`);

  /* ---------- 2. children.kumon_monthly_fee → children_fee_amounts ---------- */
  const { rows: kids } = await client.query(`
    select id, tenant_id, facility_id, name, kumon_monthly_fee
      from public.children order by facility_id, display_order nulls last`);
  let cfaWritten = 0;
  for (const k of kids) {
    if (!(k.kumon_monthly_fee > 0)) continue;
    const itemId = itemIdByFacKey.get(`${k.facility_id}|material`);
    if (!itemId) continue;
    if (APPLY) {
      await client.query(`
        insert into public.children_fee_amounts
          (tenant_id, facility_id, child_id, fee_item_id, amount)
        values ($1,$2,$3,$4,$5)
        on conflict (child_id, fee_item_id) do update set amount = excluded.amount`,
        [k.tenant_id, k.facility_id, k.id, itemId, Math.floor(k.kumon_monthly_fee)]);
    }
    cfaWritten++;
  }
  console.log(`2) 児童別金額（教材印刷代）: ${cfaWritten} 件\n`);

  /* ---------- 3. billing_summaries → billing_summary_fee_amounts ---------- */
  const { rows: summaries } = await client.query(`
    select bs.id, bs.tenant_id, bs.facility_id, bs.year, bs.month, bs.child_id,
           bs.child_name_snapshot, bs.attendance_days, bs.snack_fee, bs.snack_fee_override, bs.kumon_fee,
           c.kumon_monthly_fee
      from public.billing_summaries bs
      left join public.children c on c.id = bs.child_id
     order by bs.facility_id, bs.year, bs.month`);
  let bsfaWritten = 0;
  for (const s of summaries) {
    const pairs = [
      { key: 'snack', amount: s.snack_fee, override: s.snack_fee_override },
      { key: 'material', amount: s.kumon_fee, override: null },
    ];
    for (const p of pairs) {
      const itemId = itemIdByFacKey.get(`${s.facility_id}|${p.key}`);
      if (!itemId) continue;
      if (APPLY) {
        await client.query(`
          insert into public.billing_summary_fee_amounts
            (tenant_id, facility_id, billing_summary_id, fee_item_id, checked, amount_override, amount)
          values ($1,$2,$3,$4,false,$5,$6)
          on conflict (billing_summary_id, fee_item_id)
            do update set amount_override = excluded.amount_override, amount = excluded.amount`,
          [s.tenant_id, s.facility_id, s.id, itemId, p.override, Math.max(0, p.amount ?? 0)]);
      }
      bsfaWritten++;
    }
  }
  console.log(`3) 月次スナップショット: ${bsfaWritten} 件（${summaries.length} サマリ × 2 項目）\n`);

  /* ---------- 4. 検証: 移行前後でライブ算出額が一致するか ---------- */
  console.log('4) 検証: 移行前後のライブ算出額を実データで突合');

  /* 出席日数を schedule_entries から月次で集計（画面と同じ isAttended） */
  const { rows: entries } = await client.query(`
    select child_id, facility_id, date, pickup_time, dropoff_time, attendance_status
      from public.schedule_entries`);
  const daysByKey = new Map();
  for (const e of entries) {
    if (!isAttended(e)) continue;
    const k = `${e.child_id}|${Number(String(e.date instanceof Date ? e.date.toISOString().slice(0, 10) : e.date).slice(0, 4))}|${Number(String(e.date instanceof Date ? e.date.toISOString().slice(0, 10) : e.date).slice(5, 7))}`;
    daysByKey.set(k, (daysByKey.get(k) ?? 0) + 1);
  }

  const childById = new Map(kids.map((k) => [k.id, k]));
  let checked = 0, mismatched = 0, sumOld = 0, sumNew = 0;
  for (const s of summaries) {
    const days = daysByKey.get(`${s.child_id}|${s.year}|${s.month}`) ?? 0;
    const child = childById.get(s.child_id);

    const before = oldSnack(days, s.snack_fee_override) + oldKumon(child?.kumon_monthly_fee);
    const after =
      newFee('per_day', SNACK_FEE_PER_DAY,
        { checked: false, amountOverride: s.snack_fee_override, childAmount: null }, days) +
      newFee('per_child_monthly', 0,
        { checked: false, amountOverride: null, childAmount: oldKumon(child?.kumon_monthly_fee) }, days) +
      /* 他施設利用は未チェックなので必ず 0（列が増えても金額は動かない） */
      newFee('checkbox', 0, { checked: false, amountOverride: null, childAmount: null }, days);

    sumOld += before; sumNew += after; checked++;
    if (before !== after) {
      mismatched++;
      if (mismatched <= 10) {
        console.log(`  !! 不一致: ${s.child_name_snapshot} ${s.year}-${s.month} 前=¥${before} 後=¥${after}`);
      }
    }
  }
  console.log(`   突合 ${checked} 件 / 不一致 ${mismatched} 件`);
  console.log(`   合計 移行前 ¥${sumOld.toLocaleString('ja-JP')} → 移行後 ¥${sumNew.toLocaleString('ja-JP')}`,
    sumOld === sumNew ? '✅ 完全一致' : '❌ 金額が変わってしまう');

  if (mismatched > 0 || sumOld !== sumNew) {
    if (APPLY) {
      await client.query('ROLLBACK');
      console.log('\n❌ 金額が変わるため ROLLBACK しました。移行は行われていません。');
    }
    process.exitCode = 1;
  } else if (APPLY) {
    await client.query('COMMIT');
    console.log('\n✅ COMMIT しました。');
  } else {
    console.log('\n（DRY-RUN のため何も書いていません。--apply で実行してください）');
  }
} catch (e) {
  try { await client.query('ROLLBACK'); } catch { /* トランザクション外なら無視 */ }
  console.error('!! 移行失敗:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
