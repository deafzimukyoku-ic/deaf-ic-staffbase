/* migration 224: 兄弟グループを法人全体スコープ化 + 請求担当事業所を追加。
   rollback 付きで以下を実証する。

     1. UNIQUE が (tenant_id, label) になり、**別事業所からでも同名グループを作れない**
        （= 同じ世帯が事業所ごとに重複登録されない）
     2. 別事業所の児童を同じグループに紐付けられる
     3. billing_facility_id を設定・解除できる
     4. RLS が事業所ではなくテナントでスコープされている（manager / shift_manager）
     5. **children / billing 系の RLS は一切変わっていない**（事業所分離を緩めていないことの確認）

   接続は constraints.md §2 に従い pooler 経由（証明書検証あり）。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '224_sibling_groups_tenant_scope.sql'), 'utf8');
const client = createPgClient();

/** 変更してはいけないテーブルの policy 述語を採取して前後比較する */
async function snapshotPolicies(c, tables) {
  const { rows } = await c.query(`
    select tablename, policyname, cmd, coalesce(qual,'') qual
      from pg_policies where schemaname='public' and tablename = any($1)
     order by tablename, policyname`, [tables]);
  return rows.map((r) => `${r.tablename}.${r.policyname}[${r.cmd}] ${r.qual.replace(/\s+/g, ' ')}`);
}
const UNTOUCHED = ['children', 'billing_summaries', 'billing_summary_fee_amounts', 'children_fee_amounts'];

await client.connect();
try {
  const beforeUntouched = await snapshotPolicies(client, UNTOUCHED);
  const beforeGroups = await client.query(`select count(*)::int n from public.sibling_groups`);
  const beforeLinked = await client.query(`select count(sibling_group_id)::int n from public.children`);
  console.log(`--- before: sibling_groups ${beforeGroups.rows[0].n} 件 / 紐付け済み児童 ${beforeLinked.rows[0].n} 名 ---`);

  console.log('--- applying migration 224 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  /* 1) UNIQUE 制約 */
  const { rows: uq } = await client.query(`
    select con.conname, pg_get_constraintdef(con.oid) def
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname='public' and rel.relname='sibling_groups' and con.contype='u'`);
  console.log('UNIQUE 制約:');
  for (const u of uq) console.log(`  ${u.conname}: ${u.def}`);
  const tenantWide = uq.some((u) => /UNIQUE \(tenant_id, label\)/.test(u.def));
  const facilityScoped = uq.some((u) => /facility_id/.test(u.def));
  console.log(`  → (tenant_id, label): ${tenantWide ? '✅' : '!! 無い'} / facility_id を含む UNIQUE: ${facilityScoped ? '!! 残っている' : '✅ 無し'}`);
  if (!tenantWide || facilityScoped) process.exitCode = 1;

  /* 2) billing_facility_id 列 */
  const { rows: col } = await client.query(`
    select data_type, is_nullable from information_schema.columns
     where table_schema='public' and table_name='sibling_groups' and column_name='billing_facility_id'`);
  console.log('billing_facility_id 列:', col[0] ? `${col[0].data_type} / nullable=${col[0].is_nullable} ✅` : '!! 列が無い');

  /* 3) RLS */
  const { rows: pols } = await client.query(`
    select policyname, cmd, qual from pg_policies
     where schemaname='public' and tablename='sibling_groups' order by policyname`);
  console.log('\nsibling_groups policies:');
  for (const p of pols) {
    const roles = ['admin', 'manager', 'shift_manager', 'employee']
      .filter((r) => new RegExp(`'${r}'`).test(p.qual ?? ''));
    const hasFacility = /facility/i.test(p.qual ?? '');
    console.log(`  ${p.policyname}[${p.cmd}] ロール: ${roles.join(', ') || '(なし)'} / 事業所で絞る: ${hasFacility ? '!! はい' : 'いいえ ✅'}`);
  }
  if (pols.some((p) => /facility/i.test(p.qual ?? ''))) process.exitCode = 1;

  /* 4) 事業所分離を緩めていないことの確認（最重要） */
  const afterUntouched = await snapshotPolicies(client, UNTOUCHED);
  const same = JSON.stringify(beforeUntouched) === JSON.stringify(afterUntouched);
  console.log(`\n児童・請求系の RLS: ${same ? '✅ 前後で完全に同一（事業所分離は緩めていない）' : '!! 変化した'}`);
  if (!same) {
    for (const line of afterUntouched.filter((l) => !beforeUntouched.includes(l))) console.log('  + ' + line);
    for (const line of beforeUntouched.filter((l) => !afterUntouched.includes(l))) console.log('  - ' + line);
    process.exitCode = 1;
  }

  /* 5) 実データで挙動検証（ROLLBACK） */
  const { rows: facs } = await client.query(`
    select f.id, f.tenant_id, f.name,
           (select c.id from public.children c where c.facility_id = f.id and c.is_active limit 1) child_id
      from public.facilities f order by f.name`);
  const withChild = facs.filter((f) => f.child_id);
  if (withChild.length < 2) {
    console.log('\n!! 検証スキップ: 児童のいる事業所が 2 つ未満');
  } else {
    const [facA, facB] = withChild;
    console.log(`\n--- 挙動検証（ROLLBACK 付き / ${facA.name} × ${facB.name}）---`);
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
      const { rows: g } = await client.query(`
        insert into public.sibling_groups (tenant_id, facility_id, label, billing_facility_id)
        values ($1,$2,'__検証_きょうだい',$3) returning id`, [facA.tenant_id, facA.id, facA.id]);
      const gid = g[0].id;
      console.log(`✅ ${facA.name} でグループ作成（請求担当=${facA.name}）`);

      await expectFail('別事業所から同名グループの作成', `
        insert into public.sibling_groups (tenant_id, facility_id, label)
        values ($1,$2,'__検証_きょうだい')`, [facB.tenant_id, facB.id]);

      /* 別事業所の児童を同じグループへ（＝兄弟が別々の事業所に通うケース） */
      await client.query(`update public.children set sibling_group_id=$1 where id = any($2)`,
        [gid, [facA.child_id, facB.child_id]]);
      const { rows: linked } = await client.query(`
        select c.name, f.name fac from public.children c
        join public.facilities f on f.id = c.facility_id
        where c.sibling_group_id=$1 order by f.name`, [gid]);
      console.log(`✅ 事業所をまたいで紐付け: ${linked.map((l) => `${l.name}(${l.fac})`).join(' / ')}`);

      /* 請求担当の付け替え・解除 */
      const { rows: sw } = await client.query(`
        update public.sibling_groups set billing_facility_id=$1 where id=$2 returning billing_facility_id`,
        [facB.id, gid]);
      console.log(`✅ 請求担当を ${facB.name} に変更 → ${sw[0].billing_facility_id === facB.id ? 'OK' : '!! 反映されず'}`);
      const { rows: cl } = await client.query(`
        update public.sibling_groups set billing_facility_id=null where id=$1 returning billing_facility_id`, [gid]);
      console.log(`✅ 請求担当を未設定に戻せる → ${cl[0].billing_facility_id === null ? 'null' : '!! 残っている'}`);

      await client.query('ROLLBACK');
      console.log('\n--- 検証用データは ROLLBACK 済み（本番データは無変更）---');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! 検証失敗:', e.message.slice(0, 300));
      process.exitCode = 1;
    }
  }

  const afterGroups = await client.query(`select count(*)::int n from public.sibling_groups`);
  const afterLinked = await client.query(`select count(sibling_group_id)::int n from public.children`);
  console.log(`\n--- after: sibling_groups ${afterGroups.rows[0].n} 件 / 紐付け済み児童 ${afterLinked.rows[0].n} 名`,
    afterGroups.rows[0].n === beforeGroups.rows[0].n && afterLinked.rows[0].n === beforeLinked.rows[0].n
      ? '✅ 既存データ無変更 ---' : '!! 変化した ---');
} finally {
  await client.end();
}
