/* migration 226: 利用表の日別メモ（schedule_day_notes / schedule_day_note_labels）新設 + 検証
   検証内容:
   - 2 テーブルの列・UNIQUE・CHECK・updated_at トリガが揃っていること
   - RLS が有効で policy が各 2 本あること（admin / manager・shift_manager）
   - 本文 row_no=1..3 の INSERT が通り row_no=4 が拒否されること
   - ラベルの upsert → onConflict update → delete が動くこと
   - month の書式 CHECK が効くこと
   - **shift_day_notes（シフト表側）と完全に独立**していること（同じキーで別レコードになる）
   すべて rollback 付きで実行し、本番データは 1 行も残さない。
   接続は constraints.md §2 に従い pooler 経由。 */
import { createPgClient, loadEnv } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'migrations', '226_schedule_day_notes.sql'),
  'utf8'
);
const client = createPgClient(loadEnv());

const TABLES = ['schedule_day_notes', 'schedule_day_note_labels'];

await client.connect();
try {
  console.log('--- applying migration 226 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  for (const t of TABLES) {
    const cols = await client.query(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema='public' and table_name=$1
        order by ordinal_position`,
      [t]
    );
    console.log(`[${t}] columns:`, cols.rows.map((r) => `${r.column_name}:${r.data_type}`).join(', '));

    const rls = await client.query(
      `select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=$1`,
      [t]
    );
    const pols = await client.query(
      `select policyname, cmd from pg_policies where schemaname='public' and tablename=$1 order by policyname`,
      [t]
    );
    console.log(
      `[${t}] RLS=${rls.rows[0]?.relrowsecurity ? '有効' : '!! 無効'} policies:`,
      pols.rows.map((r) => `${r.policyname}[${r.cmd}]`).join(', ') || '(none!)'
    );

    const trg = await client.query(
      `select tgname from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
        where c.relname=$1 and not tg.tgisinternal`,
      [t]
    );
    console.log(`[${t}] triggers:`, trg.rows.map((r) => r.tgname).join(', ') || '(none!)');
  }

  const t = await client.query(`select id from public.tenants limit 1`);
  const f = await client.query(`select id from public.facilities limit 1`);
  if (!t.rows[0] || !f.rows[0]) {
    console.log('!! tenants / facilities が空のため動作検証をスキップ');
  } else {
    const tid = t.rows[0].id;
    const fid = f.rows[0].id;
    await client.query('BEGIN');
    try {
      for (const rowNo of [1, 2, 3]) {
        await client.query(
          `insert into public.schedule_day_notes (tenant_id, facility_id, date, row_no, content)
           values ($1,$2,'2099-12-31',$3,$4)`,
          [tid, fid, rowNo, `${rowNo}行目テスト`]
        );
      }
      console.log('✅ schedule_day_notes row_no=1,2,3 INSERT 成功');

      let rejected = false;
      await client.query('SAVEPOINT sp_rowno');
      try {
        await client.query(
          `insert into public.schedule_day_notes (tenant_id, facility_id, date, row_no, content)
           values ($1,$2,'2099-12-30',4,'4行目')`,
          [tid, fid]
        );
      } catch {
        rejected = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_rowno');
      }
      console.log(rejected ? '✅ row_no=4 は CHECK で拒否' : '!! row_no=4 が通ってしまった');

      /* シフト表側と独立していること: 同じ (施設, 日付, 行番号) で
         shift_day_notes に別内容を入れても衝突せず、双方が別の値を保持する */
      await client.query(
        `insert into public.shift_day_notes (tenant_id, facility_id, date, row_no, content)
         values ($1,$2,'2099-12-31',1,'シフト側の内容')
         on conflict (tenant_id, facility_id, date, row_no) do update set content=excluded.content`,
        [tid, fid]
      );
      const both = await client.query(
        `select
           (select content from public.schedule_day_notes
             where tenant_id=$1 and facility_id=$2 and date='2099-12-31' and row_no=1) as schedule_side,
           (select content from public.shift_day_notes
             where tenant_id=$1 and facility_id=$2 and date='2099-12-31' and row_no=1) as shift_side`,
        [tid, fid]
      );
      const { schedule_side, shift_side } = both.rows[0];
      console.log(
        schedule_side !== shift_side
          ? `✅ シフト表と独立: 利用表='${schedule_side}' / シフト表='${shift_side}'`
          : `!! 同じ値になっている（独立していない）: ${schedule_side}`
      );

      const ins = `
        insert into public.schedule_day_note_labels (tenant_id, facility_id, month, row_no, label)
        values ($1,$2,'2099-12',1,$3)
        on conflict (tenant_id, facility_id, month, row_no) do update set label=excluded.label
        returning label`;
      const r1 = await client.query(ins, [tid, fid, '学校行事']);
      const r2 = await client.query(ins, [tid, fid, '会議']);
      const del = await client.query(
        `delete from public.schedule_day_note_labels
          where tenant_id=$1 and facility_id=$2 and month='2099-12' and row_no=1`,
        [tid, fid]
      );
      console.log(
        `✅ labels upsert 1回目='${r1.rows[0].label}' / 2回目(update)='${r2.rows[0].label}' / delete=${del.rowCount}行`
      );

      let monthRejected = false;
      await client.query('SAVEPOINT sp_month');
      try {
        await client.query(
          `insert into public.schedule_day_note_labels (tenant_id, facility_id, month, row_no, label)
           values ($1,$2,'2099-1',1,'不正な月')`,
          [tid, fid]
        );
      } catch {
        monthRejected = true;
        await client.query('ROLLBACK TO SAVEPOINT sp_month');
      }
      console.log(monthRejected ? "✅ month='2099-1' は CHECK で拒否" : '!! 不正な月書式が通ってしまった');

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
