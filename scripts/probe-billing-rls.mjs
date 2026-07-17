/* shift_manager が billing_summaries を読み書きできるかの事実確認 (CLAUDE.md §16-2)
   - billing_summaries / billing_event_participations の policy を USING 式込みで取得
     （policy 名 bs_manager_facility は "manager" と読めるが、述語に shift_manager が
       含まれている可能性がある。名前で判断しない）
   - get_my_managed_facility_ids() が shift_manager に対して何を返すかを確認
     （migration 140 は「manager_facilities は使わず1施設固定」と述べており、
       この関数が manager_facilities だけを見ていると shift_manager は空集合＝RLS 拒否になる）
   - 実在の shift_manager の JWT を偽装して SELECT / UPDATE を実行し、実挙動で決着させる
   接続は constraints.md §2 に従い pooler 経由。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const client = createPgClient(env);

await client.connect();
try {
  for (const tbl of ['billing_summaries', 'billing_event_participations']) {
    console.log(`\n=== public.${tbl} policies (USING 式込み) ===`);
    const pols = await client.query(`
      SELECT polname,
             CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                         WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                         WHEN '*' THEN 'ALL' END AS cmd,
             pg_get_expr(polqual, polrelid) AS using_expr,
             pg_get_expr(polwithcheck, polrelid) AS check_expr
        FROM pg_policy WHERE polrelid = ('public.' || $1)::regclass
        ORDER BY polcmd, polname;`, [tbl]);
    for (const r of pols.rows) {
      console.log(`  - ${r.polname} [${r.cmd}]`);
      if (r.using_expr) console.log(`      USING: ${r.using_expr}`);
      if (r.check_expr) console.log(`      CHECK: ${r.check_expr}`);
      console.log(`      → shift_manager を述語に含む: ${/shift_manager/.test(`${r.using_expr ?? ''}${r.check_expr ?? ''}`) ? 'YES' : 'no'}`);
    }
  }

  console.log('\n=== get_my_managed_facility_ids() の定義 ===');
  const fns = await client.query(`
    SELECT proname, pg_get_functiondef(oid) AS def
      FROM pg_proc
     WHERE proname IN ('get_my_managed_facility_ids', 'get_my_role')
       AND pronamespace = 'public'::regnamespace;`);
  for (const r of fns.rows) console.log(`\n--- ${r.proname} ---\n${r.def}`);

  /* 実在の shift_manager を 1 人取得して、その JWT を偽装して実挙動を見る。
     ポリシー式の読解より、実際に行が返るかどうかが決定的な証拠になる。 */
  const sm = await client.query(`
    select e.id, e.auth_user_id, e.facility_id, e.tenant_id, e.last_name, e.first_name
      from public.employees e
     where e.role = 'shift_manager' and e.auth_user_id is not null
     limit 1`);

  if (!sm.rows[0]) {
    console.log('\n!! shift_manager が 0 人 → JWT 偽装テストはスキップ');
  } else {
    const u = sm.rows[0];
    console.log(`\n=== 実挙動テスト: shift_manager「${u.last_name}${u.first_name}」(facility=${u.facility_id}) として実行 ===`);

    /* service_role 接続のまま実行すると RLS がバイパスされるので authenticated ロールに降格 */
    await client.query('BEGIN');
    try {
      await client.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role','authenticated')::text, true)`, [u.auth_user_id]);
      await client.query(`set local role authenticated`);

      const role = await client.query(`select public.get_my_role() r`);
      console.log(`  get_my_role() = ${role.rows[0].r}`);
      const fac = await client.query(`select array(select public.get_my_managed_facility_ids())::text[] f`);
      console.log(`  get_my_managed_facility_ids() = ${JSON.stringify(fac.rows[0].f)}`);
      console.log(`    → 自 facility (${u.facility_id}) を含む: ${fac.rows[0].f?.includes(u.facility_id) ? 'YES ✅' : 'NO ❌ = RLS は必ず拒否'}`);

      /* この facility に実在する billing_summaries が RLS 越しに何行見えるか。
         service_role で数えた「真の行数」と突き合わせて、0 件問題の有無を判定する。 */
      const seen = await client.query(`select count(*)::int n from public.billing_summaries where facility_id = $1`, [u.facility_id]);
      await client.query(`set local role postgres`);
      const truth = await client.query(`select count(*)::int n from public.billing_summaries where facility_id = $1`, [u.facility_id]);
      console.log(`  billing_summaries(facility): shift_manager から見える ${seen.rows[0].n} 行 / 実在 ${truth.rows[0].n} 行`,
        seen.rows[0].n === truth.rows[0].n ? '✅ 一致' : '❌ RLS で削られている');

      /* 書込みも試す（rollback するので実データは汚さない） */
      if (truth.rows[0].n > 0) {
        await client.query(`select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role','authenticated')::text, true)`, [u.auth_user_id]);
        await client.query(`set local role authenticated`);
        const upd = await client.query(
          `update public.billing_summaries set snack_fee_override = snack_fee_override
            where facility_id = $1 returning id`, [u.facility_id]);
        console.log(`  UPDATE 試行: ${upd.rowCount} 行更新`,
          upd.rowCount > 0 ? '✅ 書込み可' : '❌ RLS で 0 行 = 保存できない');
      }
      await client.query('ROLLBACK');
      console.log('  --- テストは ROLLBACK 済み ---');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log(`  !! テスト中にエラー: ${e.message.split('\n')[0]}`);
    }
  }
} finally {
  await client.end();
}
