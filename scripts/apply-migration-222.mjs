/* migration 222: 請求項目マスタ 3 テーブル（billing_fee_items / children_fee_amounts /
   billing_summary_fee_amounts）+ RLS を適用し、以下を rollback 付きで実証する。

     1. 4 つの calc_type がすべて INSERT できる
     2. system_key の部分 UNIQUE が効く（同一施設に 'snack' を 2 つ作れない = 移行の冪等性）
     3. amount_override の 0 と null が区別される（|| 取り違えの検出）
     4. 負値が CHECK で弾かれる
     5. スナップショットを持つ fee_item は DELETE できない（on delete restrict = 過去月の紙を守る）
     6. スナップショットが無い fee_item は DELETE できる
     7. RLS ポリシーの述語に shift_manager が含まれる

   既存データ（billing_summaries 等）は一切変更しない。
   接続は constraints.md §2 に従い pooler 経由（証明書検証あり）。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '222_billing_fee_items.sql'), 'utf8');
const client = createPgClient();

await client.connect();
try {
  const before = await client.query(`select count(*)::int n from public.billing_summaries`);
  console.log(`--- before: billing_summaries ${before.rows[0].n} 行（本 migration では変更しない）---`);

  console.log('--- applying migration 222 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  /* 1) テーブル・列 */
  const tables = ['billing_fee_items', 'children_fee_amounts', 'billing_summary_fee_amounts'];
  for (const t of tables) {
    const { rows } = await client.query(`
      select column_name, data_type, is_nullable from information_schema.columns
       where table_schema='public' and table_name=$1 order by ordinal_position`, [t]);
    console.log(`${t}: ${rows.length ? '✅' : '!! 作成されていない'} ${rows.map(r => r.column_name).join(', ')}`);
  }

  /* 2) CHECK 制約 */
  const { rows: cks } = await client.query(`
    select rel.relname tbl, con.conname, pg_get_constraintdef(con.oid) def
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname='public' and rel.relname = any($1) and con.contype='c'
     order by rel.relname, con.conname`, [tables]);
  console.log('\nCHECK 制約:');
  for (const c of cks) console.log(`  ${c.tbl}.${c.conname}: ${c.def}`);

  /* 3) 部分 UNIQUE INDEX（移行の冪等性の担保） */
  const { rows: idx } = await client.query(`
    select indexname, indexdef from pg_indexes
     where schemaname='public' and indexname='uq_billing_fee_items_system_key'`);
  console.log('\nsystem_key 部分UNIQUE:', idx[0]?.indexdef ?? '!! 無い');

  /* 4) FK の on delete 動作（過去月の紙を守る RESTRICT が効いているか） */
  const { rows: fks } = await client.query(`
    select con.conname, confdeltype,
           rel.relname tbl, frel.relname ftbl
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_class frel on frel.oid = con.confrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname='public' and rel.relname='billing_summary_fee_amounts' and con.contype='f'`);
  console.log('\nbilling_summary_fee_amounts の FK:');
  for (const f of fks) {
    const act = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }[f.confdeltype];
    console.log(`  → ${f.ftbl}: on delete ${act}${f.ftbl === 'billing_fee_items' ? (act === 'RESTRICT' ? ' ✅' : ' !! RESTRICT でない') : ''}`);
  }

  /* 5) RLS ポリシー。名前ではなく述語本体に現れるロールを出す（CLAUDE.md §16-2） */
  console.log('\nRLS policies:');
  for (const t of tables) {
    const { rows: pols } = await client.query(`
      select policyname, cmd, qual from pg_policies
       where schemaname='public' and tablename=$1 order by policyname`, [t]);
    if (!pols.length) { console.log(`  ${t}: !! ポリシーが無い`); continue; }
    for (const p of pols) {
      const roles = ['admin', 'manager', 'shift_manager', 'employee']
        .filter((r) => new RegExp(`'${r}'`).test(p.qual ?? ''));
      console.log(`  ${t}.${p.policyname}[${p.cmd}] 述語のロール: ${roles.join(', ') || '(なし)'}`);
    }
    const { rows: rls } = await client.query(
      `select relrowsecurity from pg_class where relname=$1 and relnamespace='public'::regnamespace`, [t]);
    console.log(`  ${t}: RLS ${rls[0]?.relrowsecurity ? '有効 ✅' : '!! 無効'}`);
  }

  /* 6) 実データで挙動検証（すべて ROLLBACK） */
  const { rows: seed } = await client.query(`
    select bs.id summary_id, bs.tenant_id, bs.facility_id, bs.child_id
      from public.billing_summaries bs limit 1`);
  if (!seed[0]) {
    console.log('\n!! 検証スキップ: billing_summaries が 0 行');
  } else {
    const s = seed[0];
    console.log('\n--- 挙動検証（ROLLBACK 付き）---');
    await client.query('BEGIN');
    try {
      /* 制約違反はトランザクション全体を abort させるため、
         「失敗するはず」の検証は必ず SAVEPOINT で囲んで後続を続行可能にする。 */
      let spN = 0;
      const expectFail = async (label, sql, args) => {
        const sp = `sp_${spN++}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          await client.query(sql, args);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          console.log(`!! ${label} が通ってしまった`);
          process.exitCode = 1;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          console.log(`✅ ${label} は拒否: ${e.message.split('\n')[0].slice(0, 70)}`);
        }
      };

      const mkItem = async (name, calc, unit, key) => {
        const { rows } = await client.query(`
          insert into public.billing_fee_items
            (tenant_id, facility_id, name, calc_type, unit_amount, system_key)
          values ($1,$2,$3,$4,$5,$6) returning id`,
          [s.tenant_id, s.facility_id, name, calc, unit, key]);
        return rows[0].id;
      };

      const perDay = await mkItem('__検証_おやつ', 'per_day', 50, '__t_snack');
      await mkItem('__検証_教材', 'per_child_monthly', 0, null);
      await mkItem('__検証_定額', 'monthly_fixed', 1200, null);
      const checkbox = await mkItem('__検証_他施設利用', 'checkbox', 800, null);
      console.log('✅ 4 つの calc_type すべて INSERT 成功');

      /* system_key の重複は弾かれるべき（移行を何度流しても重複シードしない担保） */
      await expectFail('system_key の重複', `
        insert into public.billing_fee_items (tenant_id, facility_id, name, calc_type, system_key)
        values ($1,$2,'__検証_おやつ2','per_day','__t_snack')`, [s.tenant_id, s.facility_id]);

      /* calc_type の typo は CHECK で弾かれるべき */
      await expectFail('不正な calc_type', `
        insert into public.billing_fee_items (tenant_id, facility_id, name, calc_type)
        values ($1,$2,'__検証_不正','per_week')`, [s.tenant_id, s.facility_id]);

      /* amount_override: 0 と null の区別（本機能の最有力バグ点） */
      const upsertAmt = `
        insert into public.billing_summary_fee_amounts
          (tenant_id, facility_id, billing_summary_id, fee_item_id, checked, amount_override, amount)
        values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (billing_summary_id, fee_item_id)
          do update set amount_override = excluded.amount_override, amount = excluded.amount
        returning amount_override, amount`;
      const base = [s.tenant_id, s.facility_id, s.summary_id, perDay];

      const r0 = await client.query(upsertAmt, [...base, false, 0, 0]);
      console.log(`✅ amount_override=0 保存 → ${r0.rows[0].amount_override}`,
        r0.rows[0].amount_override === 0 ? '(null と区別されている)' : '!! 0 が null 化した');
      const rn = await client.query(upsertAmt, [...base, false, null, 500]);
      console.log(`✅ amount_override=null 保存 → ${rn.rows[0].amount_override === null ? 'null' : rn.rows[0].amount_override} (自動算出に戻る)`);

      await expectFail('amount_override=-50', upsertAmt, [...base, false, -50, 0]);

      /* checkbox 型のスナップショット */
      await client.query(upsertAmt, [s.tenant_id, s.facility_id, s.summary_id, checkbox, true, null, 800]);
      console.log('✅ checkbox 型のスナップショット保存成功（checked=true / amount=800）');

      /* スナップショットを持つ項目は削除できない = 過去月の紙が守られる */
      await expectFail('スナップショットを持つ項目の DELETE（過去月の金額を守る）',
        `delete from public.billing_fee_items where id=$1`, [perDay]);

      /* スナップショットが無い項目は削除できる */
      const { rows: freeItem } = await client.query(`
        insert into public.billing_fee_items (tenant_id, facility_id, name, calc_type)
        values ($1,$2,'__検証_未使用','monthly_fixed') returning id`, [s.tenant_id, s.facility_id]);
      const del = await client.query(`delete from public.billing_fee_items where id=$1`, [freeItem[0].id]);
      console.log(`✅ スナップショットが無い項目は DELETE 可（${del.rowCount} 行）`);

      /* children_fee_amounts */
      const cfa = await client.query(`
        insert into public.children_fee_amounts (tenant_id, facility_id, child_id, fee_item_id, amount)
        values ($1,$2,$3,$4,2000)
        on conflict (child_id, fee_item_id) do update set amount = excluded.amount
        returning amount`, [s.tenant_id, s.facility_id, s.child_id, perDay]);
      console.log(`✅ children_fee_amounts upsert 成功 → ¥${cfa.rows[0].amount}`);

      await client.query('ROLLBACK');
      console.log('\n--- 検証用データは ROLLBACK 済み（本番データは無変更）---');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! 検証失敗:', e.message.slice(0, 300));
      process.exitCode = 1;
    }
  }

  /* 適用後も既存テーブルの行数が変わっていないこと */
  const after = await client.query(`select count(*)::int n from public.billing_summaries`);
  console.log(`\n--- after: billing_summaries ${after.rows[0].n} 行`,
    after.rows[0].n === before.rows[0].n ? '✅ 既存データ無変更 ---' : '!! 行数が変わった ---');
} finally {
  await client.end();
}
