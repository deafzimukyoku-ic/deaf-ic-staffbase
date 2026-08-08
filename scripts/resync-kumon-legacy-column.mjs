/* 旧列 children.kumon_monthly_fee を children_fee_amounts（system_key='material'）に合わせ直す。
 *
 * 背景:
 *   migration 222 で教材印刷代は children_fee_amounts へ移行し、旧列は互換のため
 *   「同期して書き続けるだけ」の位置づけになった。
 *   ところが児童設定が請求項目を**施設で絞っていなかった**ため（教材印刷代は 4 事業所ぶん存在する）、
 *   system_key での find が別事業所の項目を拾い、保存すると旧列が null 化する不具合があった。
 *   2026-08-08 に 竹内天椛（パズル）で実際に発生。UI 側は修正済みで、本スクリプトはデータの復旧用。
 *
 * 重要: **請求額そのものは children_fee_amounts を見ているため、この不整合で金額は変わっていない。**
 *       直すのは互換目的の旧列だけ。
 *
 * 既定は dry-run。--apply で実行。冪等。 */
import { createPgClient } from './_db.mjs';

const APPLY = process.argv.includes('--apply');
const client = createPgClient();
await client.connect();
try {
  const { rows } = await client.query(`
    select ch.id, ch.name, f.name fac,
           ch.kumon_monthly_fee legacy,
           cfa.amount current
      from public.children ch
      join public.facilities f on f.id = ch.facility_id
      left join public.billing_fee_items i
        on i.facility_id = ch.facility_id and i.system_key = 'material'
      left join public.children_fee_amounts cfa
        on cfa.child_id = ch.id and cfa.fee_item_id = i.id
     where coalesce(ch.kumon_monthly_fee, 0) <> coalesce(cfa.amount, 0)
     order by f.name, ch.name`);

  console.log(`=== 旧列と実データの食い違い: ${rows.length} 件 ===`);
  for (const r of rows) {
    console.log(`  ${r.fac} / ${r.name}: 旧列 ${r.legacy ?? 'null'} → ${r.current ?? 'null'}（実データに合わせる）`);
  }

  if (rows.length === 0) {
    console.log('  修正不要 ✅');
  } else if (!APPLY) {
    console.log('\n（DRY-RUN のため何も更新していません。--apply で実行してください）');
  } else {
    await client.query('BEGIN');
    try {
      let n = 0;
      for (const r of rows) {
        const v = r.current != null && r.current > 0 ? r.current : null;
        await client.query(`update public.children set kumon_monthly_fee = $1 where id = $2`, [v, r.id]);
        n++;
      }
      await client.query('COMMIT');
      console.log(`\n✅ ${n} 件を更新しました（請求額には影響しません）`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('\n!! 更新失敗（ROLLBACK 済み）:', e.message);
      process.exitCode = 1;
    }
  }

  const { rows: after } = await client.query(`
    select count(*)::int n from public.children ch
      left join public.billing_fee_items i
        on i.facility_id = ch.facility_id and i.system_key = 'material'
      left join public.children_fee_amounts cfa
        on cfa.child_id = ch.id and cfa.fee_item_id = i.id
     where coalesce(ch.kumon_monthly_fee, 0) <> coalesce(cfa.amount, 0)`);
  console.log(`\n--- 現在の食い違い: ${after[0].n} 件 ---`);
} finally {
  await client.end();
}
