/* migration 225: 兄弟の設定を「グループ作成」から「他の児童を選ぶ」へ。
   label を nullable にし、候補一覧 RPC と紐付け RPC を追加する。

   rollback 付きで以下を実証する（実データ・実ロールで）:
     1. label なしでグループを作れる（職員がグループ名を考えなくてよい）
     2. set_child_siblings で 2 名を紐付けできる（**別事業所どうしでも**）
     3. 選択から外した児童は解除される
     4. 1 人以下になったグループは自動で片付く
     5. employee ロールでは候補取得も紐付けも拒否される
     6. **children / billing 系の RLS は変化していない**（事業所分離を緩めていない）

   接続は constraints.md §2 に従い pooler 経由（証明書検証あり）。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '225_sibling_pick_children_rpc.sql'), 'utf8');
const client = createPgClient();

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
  const before = await client.query(`
    select (select count(*)::int from public.sibling_groups) g,
           (select count(sibling_group_id)::int from public.children) c`);
  console.log(`--- before: グループ ${before.rows[0].g} 件 / 紐付け済み児童 ${before.rows[0].c} 名 ---`);

  console.log('--- applying migration 225 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const { rows: lbl } = await client.query(`
    select is_nullable from information_schema.columns
     where table_schema='public' and table_name='sibling_groups' and column_name='label'`);
  console.log('label 列 nullable:', lbl[0]?.is_nullable === 'YES' ? 'YES ✅' : `!! ${lbl[0]?.is_nullable}`);

  const { rows: fns } = await client.query(`
    select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) args
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('get_sibling_candidates','set_child_siblings')
     order by p.proname`);
  for (const f of fns) {
    console.log(`RPC ${f.proname}(${f.args}): security definer=${f.prosecdef ? '✅' : '!! false'}`);
  }
  if (fns.length !== 2) { console.log('!! RPC が揃っていない'); process.exitCode = 1; }

  const afterUntouched = await snapshotPolicies(client, UNTOUCHED);
  const same = JSON.stringify(beforeUntouched) === JSON.stringify(afterUntouched);
  console.log(`\n児童・請求系の RLS: ${same ? '✅ 前後で完全に同一（事業所分離は緩めていない）' : '!! 変化した'}`);
  if (!same) process.exitCode = 1;

  /* 実ロールで検証。JWT を偽装して RLS / RPC のロール判定を通す */
  const { rows: actors } = await client.query(`
    select e.auth_user_id, e.role, e.tenant_id, f.name fac
      from public.employees e
      left join public.facilities f on f.id = e.facility_id
     where e.auth_user_id is not null and e.status='active'
       and e.role in ('manager','shift_manager','employee')
     order by case e.role when 'manager' then 0 when 'shift_manager' then 1 else 2 end`);
  const mgr = actors.find((a) => a.role === 'manager' || a.role === 'shift_manager');
  const emp = actors.find((a) => a.role === 'employee');

  const { rows: pair } = await client.query(`
    select (select c.id from public.children c where c.facility_id = f.id and c.is_active limit 1) id,
           f.name fac
      from public.facilities f
     where exists (select 1 from public.children c where c.facility_id=f.id and c.is_active)
     order by f.name limit 2`);

  if (!mgr || pair.length < 2) {
    console.log('\n!! 検証スキップ: manager 系アカウントまたは 2 事業所分の児童が見つからない');
  } else {
    console.log(`\n--- 挙動検証（${mgr.role} / ${mgr.fac} 視点・ROLLBACK 付き）---`);
    await client.query('BEGIN');
    try {
      const asRole = async (uid, role) => {
        await client.query(`set local role authenticated`);
        await client.query(`select set_config('request.jwt.claims', $1, true)`,
          [JSON.stringify({ sub: uid, role: 'authenticated' })]);
        void role;
      };
      await asRole(mgr.auth_user_id, mgr.role);

      const { rows: cand } = await client.query(`select * from public.get_sibling_candidates()`);
      const facs = new Set(cand.map((c) => c.facility_name));
      console.log(`✅ 候補取得: ${cand.length} 名 / ${facs.size} 事業所（${[...facs].join(', ')}）`);
      if (facs.size < 2) { console.log('  !! 全事業所ぶん返っていない'); process.exitCode = 1; }
      const leaked = Object.keys(cand[0] ?? {}).filter((k) =>
        !['id', 'name', 'facility_id', 'facility_name', 'sibling_group_id'].includes(k));
      console.log(`✅ 返却列は最小限: ${Object.keys(cand[0] ?? {}).join(', ')}${leaked.length ? ` !! 余計な列 ${leaked}` : ''}`);

      /* 別事業所どうしを紐付け */
      const [a, b] = pair;
      const { rows: g1 } = await client.query(`select public.set_child_siblings($1, $2) gid`, [a.id, [b.id]]);
      console.log(`✅ ${a.fac} × ${b.fac} の児童を紐付け（グループ ${String(g1[0].gid).slice(0, 8)}…）`);

      /* 検証の SELECT は role を戻してから行う。
         manager のまま children を読むと RLS で自事業所しか返らず、
         「別事業所への書き込みが効いていない」と誤読してしまう（初回この罠に嵌った）。 */
      const asOwner = async () => { await client.query('reset role'); };
      await asOwner();
      const { rows: linked } = await client.query(`
        select c.name, f.name fac from public.children c
        join public.facilities f on f.id=c.facility_id
        where c.sibling_group_id = $1 order by f.name`, [g1[0].gid]);
      console.log(`   → ${linked.map((l) => `${l.name}(${l.fac})`).join(' / ')}`,
        linked.length === 2 ? '✅ 別事業所どうしで紐付けできている' : '!! 2 名になっていない');
      if (linked.length !== 2) process.exitCode = 1;

      const { rows: noLabel } = await client.query(
        `select label from public.sibling_groups where id=$1`, [g1[0].gid]);
      console.log(`✅ label は ${noLabel[0].label === null ? 'null（グループ名不要）' : `!! '${noLabel[0].label}'`}`);

      await asRole(mgr.auth_user_id, mgr.role);

      /* 解除 → グループが片付くこと */
      await client.query(`select public.set_child_siblings($1, $2)`, [a.id, []]);
      await client.query('reset role');
      const { rows: after } = await client.query(`
        select (select count(*)::int from public.children where sibling_group_id=$1) n,
               (select count(*)::int from public.sibling_groups where id=$1) g`, [g1[0].gid]);
      console.log(`✅ 解除後: 紐付け ${after[0].n} 名 / グループ ${after[0].g} 件`,
        after[0].n === 0 && after[0].g === 0 ? '（1人以下のグループは自動で片付く）' : '!! 残っている');
      if (after[0].n !== 0 || after[0].g !== 0) process.exitCode = 1;

      /* employee は拒否されること */
      if (emp) {
        await asRole(emp.auth_user_id, 'employee');
        const { rows: ec } = await client.query(`select * from public.get_sibling_candidates()`);
        console.log(`✅ employee の候補取得: ${ec.length} 件`, ec.length === 0 ? '（拒否 ✅）' : '!! 返ってしまった');
        if (ec.length !== 0) process.exitCode = 1;
        await client.query('SAVEPOINT sp_emp');
        try {
          await client.query(`select public.set_child_siblings($1, $2)`, [pair[0].id, [pair[1].id]]);
          await client.query('RELEASE SAVEPOINT sp_emp');
          console.log('!! employee が紐付けできてしまった'); process.exitCode = 1;
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT sp_emp');
          console.log('✅ employee の紐付けは拒否:', e.message.split('\n')[0].slice(0, 60));
        }
      } else {
        console.log('（employee アカウントが無いため権限テストはスキップ）');
      }

      await client.query('ROLLBACK');
      console.log('\n--- 検証用データは ROLLBACK 済み（本番データは無変更）---');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! 検証失敗:', e.message.slice(0, 300));
      process.exitCode = 1;
    }
  }

  const after = await client.query(`
    select (select count(*)::int from public.sibling_groups) g,
           (select count(sibling_group_id)::int from public.children) c`);
  console.log(`\n--- after: グループ ${after.rows[0].g} 件 / 紐付け済み児童 ${after.rows[0].c} 名`,
    after.rows[0].g === before.rows[0].g && after.rows[0].c === before.rows[0].c
      ? '✅ 既存データ無変更 ---' : '!! 変化した ---');
} finally {
  await client.end();
}
