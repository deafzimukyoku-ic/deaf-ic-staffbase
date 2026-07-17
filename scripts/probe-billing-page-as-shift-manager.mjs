/* 「shift_manager は利用料金表を開いても 0 件・保存でエラー」という主張の実挙動検証 (CLAUDE.md §16-2)
   BillingFull.tsx の fetchAll (:140-193) / handleSave (:526-560) が触る全テーブルを、
   実在の shift_manager の JWT を偽装して同じ条件で叩き、RLS で削られる行が無いかを確認する。
   ポリシー式の読解ではなく「実際に何行返るか」で決着させる。
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
  const sm = await client.query(`
    select e.id, e.auth_user_id, e.facility_id, e.tenant_id, e.last_name, e.first_name
      from public.employees e
     where e.role = 'shift_manager' and e.auth_user_id is not null limit 1`);
  if (!sm.rows[0]) { console.log('!! shift_manager が 0 人 → 検証不能'); process.exit(0); }
  const u = sm.rows[0];
  console.log(`shift_manager「${u.last_name}${u.first_name}」/ facility=${u.facility_id}\n`);

  /* 検証対象の月は「実際に billing_summaries がある月」を選ぶ（空月だと 0 件が正常と紛らわしい） */
  const ym = await client.query(`
    select year, month, count(*)::int n from public.billing_summaries
     where facility_id = $1 group by year, month order by n desc limit 1`, [u.facility_id]);
  if (!ym.rows[0]) { console.log('!! この facility に billing_summaries が無い'); process.exit(0); }
  const { year, month } = ym.rows[0];
  const from = `${year}-${String(month).padStart(2,'0')}-01`;
  const to = `${year}-${String(month).padStart(2,'0')}-31`;
  console.log(`検証月: ${year}年${month}月\n`);

  /* BillingFull.tsx の fetchAll と同じクエリ群。service_role(真の行数) と authenticated(RLS 越し) を突合 */
  const queries = [
    ['facilities         (:141)', `select count(*)::int n from public.facilities where id = $1`, [u.facility_id]],
    ['children           (:143)', `select count(*)::int n from public.children where tenant_id=$1 and facility_id=$2 and is_active=true`, [u.tenant_id, u.facility_id]],
    ['events             (:150)', `select count(*)::int n from public.events where tenant_id=$1 and facility_id=$2 and date>=$3 and date<=$4`, [u.tenant_id, u.facility_id, from, to]],
    ['schedule_entries   (:160)', `select count(*)::int n from public.schedule_entries where tenant_id=$1 and facility_id=$2 and date>=$3 and date<=$4`, [u.tenant_id, u.facility_id, from, to]],
    ['billing_summaries  (:167)', `select count(*)::int n from public.billing_summaries where tenant_id=$1 and facility_id=$2 and year=$3 and month=$4`, [u.tenant_id, u.facility_id, year, month]],
    ['billing_event_part.(:191)', `select count(*)::int n from public.billing_event_participations p where exists (select 1 from public.billing_summaries bs where bs.id=p.billing_summary_id and bs.facility_id=$1)`, [u.facility_id]],
    ['employees(自分)    (:124)', `select count(*)::int n from public.employees where auth_user_id=$1`, [u.auth_user_id]],
  ];

  console.log('=== fetchAll の読み取り (RLS 越し / 実在) ===');
  let allOk = true;
  for (const [label, sql, args] of queries) {
    await client.query('BEGIN');
    await client.query(`select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`, [u.auth_user_id]);
    await client.query('set local role authenticated');
    let seen;
    try { seen = (await client.query(sql, args)).rows[0].n; }
    catch (e) { seen = `ERR: ${e.message.split('\n')[0].slice(0,60)}`; }
    await client.query('set local role postgres');
    const truth = (await client.query(sql, args)).rows[0].n;
    await client.query('ROLLBACK');
    const ok = seen === truth;
    if (!ok) allOk = false;
    console.log(`  ${label}: ${seen} / ${truth} ${ok ? '✅' : '❌ RLS で削られている'}`);
  }

  /* handleSave の upsert (:526) を snack_fee_override 込みで実行（rollback 付き） */
  console.log('\n=== handleSave の書込み (snack_fee_override 込み / rollback 付き) ===');
  await client.query('BEGIN');
  try {
    await client.query(`select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`, [u.auth_user_id]);
    await client.query('set local role authenticated');
    const child = await client.query(`select child_id from public.billing_summaries where facility_id=$1 and year=$2 and month=$3 limit 1`, [u.facility_id, year, month]);
    const r = await client.query(`
      insert into public.billing_summaries
        (tenant_id, facility_id, year, month, child_id, attendance_days, snack_fee, snack_fee_override)
      values ($1,$2,$3,$4,$5,10,500,350)
      on conflict (tenant_id, facility_id, year, month, child_id)
        do update set snack_fee_override = excluded.snack_fee_override
      returning snack_fee_override`,
      [u.tenant_id, u.facility_id, year, month, child.rows[0].child_id]);
    console.log(`  upsert (override=350): ✅ 成功 → ${r.rows[0].snack_fee_override}`);
  } catch (e) {
    allOk = false;
    console.log(`  upsert: ❌ 失敗 → ${e.message.split('\n')[0]}`);
  }
  await client.query('ROLLBACK');
  console.log('  --- ROLLBACK 済み ---');

  console.log(`\n${'='.repeat(60)}\n結論: shift_manager は利用料金表を ${allOk ? '完全に読み書きできる ✅（不整合は存在しない）' : '一部読み書きできない ❌'}`);
} finally {
  await client.end();
}
