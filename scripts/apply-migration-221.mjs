/* migration 221: billing_summaries.snack_fee_override 追加 + 検証
   - 列と CHECK 制約が存在すること
   - override 付き upsert が通ること / 負値が CHECK で弾かれること / 0 と null が区別されること
   - 既存行が null（= 従来どおり自動算出 = 過去月の数字が変わらない）ことを確認
   接続は constraints.md §2 に従い pooler 経由。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];})
);
const migrationSql = fs.readFileSync(path.resolve(__dirname,'..','supabase','migrations','221_billing_snack_fee_override.sql'),'utf8');
const client = createPgClient(env);

await client.connect();
try {
  /* 適用前: 既存行の override 分布（適用後に「全部 null = 過去月の数字が変わらない」を言うための基準） */
  const before = await client.query(`select count(*)::int n from public.billing_summaries`);
  console.log(`--- before: billing_summaries ${before.rows[0].n} 行 ---`);

  console.log('--- applying migration 221 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const col = await client.query(`
    select data_type, is_nullable from information_schema.columns
     where table_schema='public' and table_name='billing_summaries' and column_name='snack_fee_override'`);
  console.log('snack_fee_override 列:', col.rows[0]
    ? `${col.rows[0].data_type} / nullable=${col.rows[0].is_nullable} ✅`
    : '!! 列が無い');

  const ck = await client.query(`
    select pg_get_constraintdef(con.oid) def from pg_constraint con
     join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace
    where rel.relname='billing_summaries' and n.nspname='public'
      and con.conname='billing_summaries_snack_fee_override_range'`);
  console.log('CHECK 制約:', ck.rows[0]?.def ?? '!! 制約が無い');

  /* 既存行は全て null であるべき（= 過去に保存済みの月は自動算出のままで数字が変わらない） */
  const nulls = await client.query(`
    select count(*)::int total, count(snack_fee_override)::int overridden from public.billing_summaries`);
  console.log(`既存行の override: ${nulls.rows[0].overridden} / ${nulls.rows[0].total} 行`,
    nulls.rows[0].overridden === 0 ? '✅ 全て null = 過去月の数字は不変' : '!! 想定外に値が入っている');

  /* RLS ポリシーが列追加で壊れていないこと（for all のため新列も同ポリシー配下）。
     policy 名だけを出すと誤読する: bs_manager_facility は名前が "manager" と読めるが
     述語は get_my_role() in ('manager','shift_manager') で shift_manager も含む。
     実際 2026-07-17 に「shift_manager 用ポリシーが存在しない」と誤診した実績があるため、
     必ず USING 式と「どのロールが述語に現れるか」まで出力する。 */
  const pols = await client.query(`
    select policyname, cmd, qual, with_check from pg_policies
     where schemaname='public' and tablename='billing_summaries' order by policyname`);
  console.log('billing_summaries policies:');
  for (const p of pols.rows) {
    const expr = `${p.qual ?? ''} ${p.with_check ?? ''}`;
    const roles = ['admin', 'manager', 'shift_manager', 'employee'].filter((r) =>
      new RegExp(`'${r}'`).test(expr));
    console.log(`  - ${p.policyname}[${p.cmd}] 述語に現れるロール: ${roles.join(', ') || '(なし)'}`);
    console.log(`      USING: ${p.qual ?? '(none)'}`);
  }
  if (pols.rows.length === 0) console.log('  (none!)');

  /* 実データで upsert 検証（rollback 付き） */
  const seed = await client.query(`
    select bs.tenant_id, bs.facility_id, bs.year, bs.month, bs.child_id
      from public.billing_summaries bs limit 1`);
  const fallback = await client.query(`
    select c.tenant_id, c.facility_id, c.id child_id from public.children c limit 1`);
  const row = seed.rows[0] ?? (fallback.rows[0] ? { ...fallback.rows[0], year: 2099, month: 12 } : null);

  if (!row) {
    console.log('!! 検証スキップ: children も billing_summaries も 0 行');
  } else {
    await client.query('BEGIN');
    try {
      const up = `
        insert into public.billing_summaries
          (tenant_id, facility_id, year, month, child_id, attendance_days, snack_fee, snack_fee_override)
        values ($1,$2,$3,$4,$5,10,500,$6)
        on conflict (tenant_id, facility_id, year, month, child_id)
          do update set snack_fee_override = excluded.snack_fee_override
        returning snack_fee_override`;
      const args = [row.tenant_id, row.facility_id, 2099, 12, row.child_id];

      const r1 = await client.query(up, [...args, 550]);
      console.log(`✅ override=550 upsert 成功 → ${r1.rows[0].snack_fee_override}`);

      const r2 = await client.query(up, [...args, 0]);
      console.log(`✅ override=0 (手動0円固定) 保存成功 → ${r2.rows[0].snack_fee_override}`,
        r2.rows[0].snack_fee_override === 0 ? '(null と区別されている)' : '!! 0 が null 化した');

      const r3 = await client.query(up, [...args, null]);
      console.log(`✅ override=null (自動に戻す) 保存成功 → ${r3.rows[0].snack_fee_override === null ? 'null' : r3.rows[0].snack_fee_override}`);

      /* 負値は CHECK で弾かれるべき */
      try {
        await client.query(up, [...args, -50]);
        console.log('!! 負値が通ってしまった（CHECK が効いていない）');
        process.exitCode = 1;
      } catch (e) {
        console.log('✅ override=-50 は CHECK で拒否:', e.message.split('\n')[0].slice(0,80));
      }

      await client.query('ROLLBACK');
      console.log('\n--- 検証用データは ROLLBACK 済み ---');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! 検証失敗:', e.message.slice(0,200));
      process.exitCode = 1;
    }
  }
} finally {
  await client.end();
}
