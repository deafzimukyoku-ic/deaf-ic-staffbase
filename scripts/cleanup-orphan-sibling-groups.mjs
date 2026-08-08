/* 孤立した兄弟グループ（メンバー 0〜1 名）を削除する。
 *
 * 背景:
 *   migration 225 で UI からグループの概念を消したため、それ以前に画面から作られた
 *   グループが「メンバー 0 名」で残ることがある。新 UI からは到達できない死にデータになる。
 *   （225 以降に RPC set_child_siblings 経由で作られたものは自動で片付くので、対象は主に旧データ）
 *
 * 安全策:
 *   - **メンバーが 2 名以上のグループは絶対に削除しない**（実際に使われている世帯）
 *   - 既定は dry-run。実行するには --apply を付ける
 *   - 1 名だけのグループは「きょうだいが 1 人」＝意味を持たないため、
 *     その児童の sibling_group_id を外したうえでグループを削除する（--include-single 指定時のみ）
 *
 * 接続は constraints.md §2 に従い pooler 経由（証明書検証あり）。 */
import { createPgClient } from './_db.mjs';

const APPLY = process.argv.includes('--apply');
const INCLUDE_SINGLE = process.argv.includes('--include-single');

const client = createPgClient();
await client.connect();
try {
  const { rows } = await client.query(`
    select g.id, g.label, g.billing_facility_id, f.name created_at_facility,
           bf.name billing_facility_name,
           (select count(*)::int from public.children c where c.sibling_group_id = g.id) members
      from public.sibling_groups g
      left join public.facilities f on f.id = g.facility_id
      left join public.facilities bf on bf.id = g.billing_facility_id
     order by members desc, g.created_at`);

  console.log(`=== 兄弟グループ ${rows.length} 件 ===`);
  for (const r of rows) {
    const mark = r.members >= 2 ? '保持' : r.members === 1 ? '1名のみ' : '孤立(0名)';
    console.log(`  [${mark}] label=${r.label ?? '(なし)'} / メンバー ${r.members} 名 / 作成元 ${r.created_at_facility ?? '?'}`
      + (r.billing_facility_name ? ` / 請求担当 ${r.billing_facility_name}` : ''));
    if (r.members >= 1 && r.members <= 1) {
      const { rows: who } = await client.query(
        `select c.name, f.name fac from public.children c
         join public.facilities f on f.id=c.facility_id where c.sibling_group_id=$1`, [r.id]);
      for (const w of who) console.log(`        └ ${w.name}（${w.fac}）`);
    }
  }

  const orphans = rows.filter((r) => r.members === 0);
  const singles = rows.filter((r) => r.members === 1);
  const keep = rows.filter((r) => r.members >= 2);
  console.log(`\n削除対象: 孤立(0名) ${orphans.length} 件`
    + (INCLUDE_SINGLE ? ` + 1名のみ ${singles.length} 件` : ` / 1名のみ ${singles.length} 件は対象外（--include-single で含める）`));
  console.log(`保持: メンバー2名以上 ${keep.length} 件（絶対に消さない）`);

  const targets = INCLUDE_SINGLE ? [...orphans, ...singles] : orphans;
  if (targets.length === 0) {
    console.log('\n削除対象はありません。');
  } else if (!APPLY) {
    console.log('\n（DRY-RUN のため何も削除していません。--apply で実行してください）');
  } else {
    await client.query('BEGIN');
    try {
      const ids = targets.map((t) => t.id);
      /* 念のため削除直前にもう一度メンバー数を確認する（実行までの間に紐付けられた場合の保険） */
      const { rows: recheck } = await client.query(`
        select g.id, (select count(*)::int from public.children c where c.sibling_group_id = g.id) n
          from public.sibling_groups g where g.id = any($1)`, [ids]);
      const unsafe = recheck.filter((r) => r.n >= 2);
      if (unsafe.length > 0) {
        throw new Error(`削除直前に ${unsafe.length} 件がメンバー2名以上になっていたため中止しました`);
      }
      const safeIds = recheck.map((r) => r.id);
      /* 1名のみのグループは先に児童側の紐付けを外す */
      const unlinked = await client.query(
        `update public.children set sibling_group_id = null where sibling_group_id = any($1)`, [safeIds]);
      const deleted = await client.query(
        `delete from public.sibling_groups where id = any($1)`, [safeIds]);
      await client.query('COMMIT');
      console.log(`\n✅ グループ ${deleted.rowCount} 件を削除（児童の紐付け解除 ${unlinked.rowCount} 件）`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('\n!! 削除失敗（ROLLBACK 済み）:', e.message);
      process.exitCode = 1;
    }
  }

  const after = await client.query(`
    select (select count(*)::int from public.sibling_groups) g,
           (select count(sibling_group_id)::int from public.children) c`);
  console.log(`\n--- 現在: グループ ${after.rows[0].g} 件 / 紐付け済み児童 ${after.rows[0].c} 名 ---`);
} finally {
  await client.end();
}
