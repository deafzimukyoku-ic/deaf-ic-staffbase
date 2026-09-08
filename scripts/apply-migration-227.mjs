/* migration 227: 業務日報の日別自由入力（daily_report_notes）新設 + 検証
   検証内容:
   - 列 / UNIQUE / updated_at トリガ / RLS 2 本
   - upsert → onConflict update → delete が動くこと
   - 同じ (施設, 日付) が 2 行作れないこと（UNIQUE）
   - updated_at がトリガで実際に前進すること
   すべて rollback 付きで実行し、本番データは 1 行も残さない。
   接続は constraints.md §2 に従い pooler 経由。 */
import { createPgClient, loadEnv } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '227_daily_report_notes.sql'),
  'utf8'
);
const client = createPgClient(loadEnv());

await client.connect();
try {
  console.log('--- applying migration 227 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const cols = await client.query(
    `select column_name, data_type from information_schema.columns
      where table_schema='public' and table_name='daily_report_notes' order by ordinal_position`
  );
  console.log('columns:', cols.rows.map((r) => `${r.column_name}:${r.data_type}`).join(', '));

  const rls = await client.query(
    `select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='daily_report_notes'`
  );
  const pols = await client.query(
    `select policyname, cmd from pg_policies
      where schemaname='public' and tablename='daily_report_notes' order by policyname`
  );
  console.log(
    `RLS=${rls.rows[0]?.relrowsecurity ? '有効' : '!! 無効'} policies:`,
    pols.rows.map((r) => `${r.policyname}[${r.cmd}]`).join(', ') || '(none!)'
  );

  const trg = await client.query(
    `select tgname from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
      where c.relname='daily_report_notes' and not tg.tgisinternal`
  );
  console.log('triggers:', trg.rows.map((r) => r.tgname).join(', ') || '(none!)');

  const t = await client.query(`select id from public.tenants limit 1`);
  const f = await client.query(`select id from public.facilities limit 1`);
  if (!t.rows[0] || !f.rows[0]) {
    console.log('!! tenants / facilities が空のため動作検証をスキップ');
  } else {
    const tid = t.rows[0].id;
    const fid = f.rows[0].id;
    await client.query('BEGIN');
    try {
      const ins = `
        insert into public.daily_report_notes (tenant_id, facility_id, date, content)
        values ($1,$2,'2099-12-31',$3)
        on conflict (tenant_id, facility_id, date) do update set content=excluded.content
        returning content, updated_at`;
      const r1 = await client.query(ins, [tid, fid, '午前: 制作活動 / 午後: 公園']);
      const r2 = await client.query(ins, [tid, fid, '午前: 制作活動 / 午後: 室内あそび（雨天）']);
      console.log(`✅ upsert 1回目='${r1.rows[0].content}'`);
      console.log(`✅ upsert 2回目(update)='${r2.rows[0].content}'`);

      /* updated_at トリガの検証。
         注意: set_updated_at は now() = **トランザクション開始時刻** を入れるので、
         同一トランザクション内で 2 回書いても値は同じになる。「前進したか」では検証できない。
         そこで「updated_at に過去日時を明示的に書き込んでも、トリガが now() で握りつぶすか」を見る。 */
      const forced = await client.query(
        `update public.daily_report_notes set updated_at='2000-01-01T00:00:00Z'
          where tenant_id=$1 and facility_id=$2 and date='2099-12-31'
          returning updated_at`,
        [tid, fid]
      );
      const gotYear = new Date(forced.rows[0].updated_at).getUTCFullYear();
      console.log(
        gotYear > 2000
          ? `✅ updated_at トリガが発火（2000-01-01 の明示指定を ${gotYear} 年の now() で上書き）`
          : `!! updated_at トリガが発火していない（${forced.rows[0].updated_at} のまま）`
      );

      const cnt = await client.query(
        `select count(*)::int n from public.daily_report_notes
          where tenant_id=$1 and facility_id=$2 and date='2099-12-31'`,
        [tid, fid]
      );
      console.log(cnt.rows[0].n === 1 ? '✅ UNIQUE により 1 行のまま' : `!! ${cnt.rows[0].n} 行できている`);

      let dup = false;
      await client.query('SAVEPOINT sp_dup');
      try {
        await client.query(
          `insert into public.daily_report_notes (tenant_id, facility_id, date, content)
           values ($1,$2,'2099-12-31','重複')`,
          [tid, fid]
        );
      } catch {
        dup = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_dup');
      }
      console.log(dup ? '✅ 同じ(施設,日付)の二重 INSERT は UNIQUE で拒否' : '!! 重複が通ってしまった');

      const del = await client.query(
        `delete from public.daily_report_notes
          where tenant_id=$1 and facility_id=$2 and date='2099-12-31'`,
        [tid, fid]
      );
      console.log(`✅ delete=${del.rowCount}行（空入力で行を残さない運用の裏付け）`);

      await client.query('ROLLBACK');
      console.log('\n--- 検証用データは ROLLBACK 済（本番データ変更なし） ---');
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('!! 検証失敗:', e.message.slice(0, 200));
      process.exitCode = 1;
    }
  }
} finally {
  await client.end();
}
