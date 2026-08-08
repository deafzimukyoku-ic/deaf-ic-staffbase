/* migration 223: sibling_groups + children.sibling_group_id を適用し、
   以下を rollback 付きで実証する。

     1. 既存の children 全行が sibling_group_id = null（＝現行の表示・計算に一切影響しない後方互換）
     2. グループ作成 → 児童 2 名の紐付けができる
     3. 同一施設で label の重複は拒否される
     4. グループを削除すると children.sibling_group_id は null に戻る（児童は消えない = set null）
     5. RLS ポリシーの述語に shift_manager が含まれる

   接続は constraints.md §2 に従い pooler 経由（証明書検証あり）。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '223_children_sibling_group.sql'), 'utf8');
const client = createPgClient();

await client.connect();
try {
  const before = await client.query(`select count(*)::int n from public.children`);
  console.log(`--- before: children ${before.rows[0].n} 行 ---`);

  console.log('--- applying migration 223 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const { rows: cols } = await client.query(`
    select column_name, data_type, is_nullable from information_schema.columns
     where table_schema='public' and table_name='sibling_groups' order by ordinal_position`);
  console.log('sibling_groups:', cols.length ? `✅ ${cols.map(c => c.column_name).join(', ')}` : '!! 作成されていない');

  const { rows: sgCol } = await client.query(`
    select data_type, is_nullable from information_schema.columns
     where table_schema='public' and table_name='children' and column_name='sibling_group_id'`);
  console.log('children.sibling_group_id:', sgCol[0]
    ? `${sgCol[0].data_type} / nullable=${sgCol[0].is_nullable} ✅` : '!! 列が無い');

  /* 既存行は全て null であるべき = 料金表の表示が今と 1 mm も変わらない */
  const { rows: nulls } = await client.query(`
    select count(*)::int total, count(sibling_group_id)::int grouped from public.children`);
  console.log(`既存 children の兄弟設定: ${nulls[0].grouped} / ${nulls[0].total} 行`,
    nulls[0].grouped === 0 ? '✅ 全て null = 現行の表示・計算に影響しない' : '!! 想定外に値が入っている');

  /* FK の on delete（グループを消しても児童は消えない） */
  const { rows: fks } = await client.query(`
    select con.conname, con.confdeltype, frel.relname ftbl
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_class frel on frel.oid = con.confrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname='public' and rel.relname='children' and con.contype='f'
       and frel.relname='sibling_groups'`);
  const act = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }[fks[0]?.confdeltype];
  console.log('children → sibling_groups の on delete:', act ?? '!! FK が無い',
    act === 'SET NULL' ? '✅（グループを消しても児童は残る）' : '!! SET NULL でない');

  console.log('\nRLS policies:');
  const { rows: pols } = await client.query(`
    select policyname, cmd, qual from pg_policies
     where schemaname='public' and tablename='sibling_groups' order by policyname`);
  for (const p of pols) {
    const roles = ['admin', 'manager', 'shift_manager', 'employee']
      .filter((r) => new RegExp(`'${r}'`).test(p.qual ?? ''));
    console.log(`  ${p.policyname}[${p.cmd}] 述語のロール: ${roles.join(', ') || '(なし)'}`);
  }
  if (!pols.length) console.log('  !! ポリシーが無い');
  const { rows: rls } = await client.query(
    `select relrowsecurity from pg_class where relname='sibling_groups' and relnamespace='public'::regnamespace`);
  console.log('  RLS', rls[0]?.relrowsecurity ? '有効 ✅' : '!! 無効');

  /* 実データで挙動検証（ROLLBACK） */
  const { rows: kids } = await client.query(`
    select id, tenant_id, facility_id, name from public.children
     where is_active = true order by facility_id, display_order nulls last limit 2`);
  if (kids.length < 2) {
    console.log('\n!! 検証スキップ: active な children が 2 名未満');
  } else if (kids[0].facility_id !== kids[1].facility_id) {
    console.log('\n!! 検証スキップ: 先頭 2 名が同一施設でない');
  } else {
    console.log('\n--- 挙動検証（ROLLBACK 付き）---');
    await client.query('BEGIN');
    let spN = 0;
    const expectFail = async (label, sql, args) => {
      const sp = `sp_${spN++}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        await client.query(sql, args);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        console.log(`!! ${label} が通ってしまった`); process.exitCode = 1;
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        console.log(`✅ ${label} は拒否: ${e.message.split('\n')[0].slice(0, 70)}`);
      }
    };
    try {
      const [a, b] = kids;
      const { rows: grp } = await client.query(`
        insert into public.sibling_groups (tenant_id, facility_id, label)
        values ($1,$2,'__検証_きょうだい') returning id`, [a.tenant_id, a.facility_id]);
      const gid = grp[0].id;
      console.log('✅ sibling_groups 作成成功');

      await client.query(`update public.children set sibling_group_id=$1 where id = any($2)`,
        [gid, [a.id, b.id]]);
      const { rows: linked } = await client.query(`
        select name from public.children where sibling_group_id=$1 order by name`, [gid]);
      console.log(`✅ 児童 ${linked.length} 名を紐付け: ${linked.map(r => r.name).join(', ')}`);

      await expectFail('同一施設での label 重複', `
        insert into public.sibling_groups (tenant_id, facility_id, label)
        values ($1,$2,'__検証_きょうだい')`, [a.tenant_id, a.facility_id]);

      /* グループ削除 → 児童は残り sibling_group_id だけ null に戻る */
      await client.query(`delete from public.sibling_groups where id=$1`, [gid]);
      const { rows: after } = await client.query(`
        select count(*)::int alive, count(sibling_group_id)::int still
          from public.children where id = any($1)`, [[a.id, b.id]]);
      console.log(`✅ グループ削除後: 児童 ${after[0].alive} 名は残存 / 紐付け ${after[0].still} 件`,
        after[0].alive === 2 && after[0].still === 0 ? '（set null が正しく効いている）' : '!! 想定外');

      await client.query('ROLLBACK');
      console.log('\n--- 検証用データは ROLLBACK 済み（本番データは無変更）---');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! 検証失敗:', e.message.slice(0, 300));
      process.exitCode = 1;
    }
  }

  const after = await client.query(`
    select count(*)::int n, count(sibling_group_id)::int g from public.children`);
  console.log(`\n--- after: children ${after.rows[0].n} 行 / 兄弟設定 ${after.rows[0].g} 件`,
    after.rows[0].n === before.rows[0].n && after.rows[0].g === 0
      ? '✅ 既存データ無変更 ---' : '!! 想定外の変化 ---');
} finally {
  await client.end();
}
