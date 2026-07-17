/* probe: migration 131 (131_multi_facility_rls.sql) が本番 DB に適用済かを事実確認する。
   docs/reference-map.md:35 が「🆕 未適用」、docs/migration-applied.md が 220 まで適用済 という
   台帳同士の矛盾を、実 DB の policy 本体 (qual) で判定する。

   判定基準 (127/128 版 vs 131 版の見分け方):
     - 127/128 版: facility_id = (select facility_id from employees where auth_user_id = auth.uid() limit 1)
                   → 主所属 1 施設のみ。兼任非対応。スカラー比較 (=)
     - 131 版    : facility_id in (select get_my_managed_facility_ids())
                   → 兼任対応。ヘルパー関数 + in

   接続は constraints.md §2 に従い pooler 経由 (直接ホストは IPv6-only)。
   読み取り専用。DB を一切変更しない。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const client = createPgClient(env);

/* 131 が作る/置き換える policy の一覧 (テーブル, policy 名, 131 版なら qual に含まれるはずの印) */
const EXPECTED = [
  ['children', 'children_manager_facility', 'get_my_managed_facility_ids'],
  ['schedule_entries', 'se_manager_facility', 'get_my_managed_facility_ids'],
  ['shift_requests', 'sr_manager_facility', 'employee_in_my_managed_facilities'],
  ['shift_requests', 'sr_employee_own', 'get_my_facility_ids'],
  ['shift_assignments', 'sa_manager_facility', 'get_my_managed_facility_ids'],
  ['shift_assignments', 'sa_manager_cross_facility_select', 'employee_in_my_managed_facilities'],
  ['shift_assignments', 'sa_employee_cross_facility_select', 'publish_status'],
  ['transport_assignments', 'ta_admin_all', 'admin'],
  ['transport_assignments', 'ta_manager_facility', 'get_my_managed_facility_ids'],
  ['shift_change_requests', 'scr_select', 'employee_in_my_managed_facilities'],
  ['shift_change_requests', 'scr_insert', 'employee_in_my_managed_facilities'],
  ['shift_change_requests', 'scr_update', 'employee_in_my_managed_facilities'],
  ['shift_change_requests', 'scr_delete', 'admin'],
  ['facility_shift_settings', 'fss_manager_own', 'get_my_managed_facility_ids'],
  ['events', 'ev_manager_facility', 'get_my_managed_facility_ids'],
  ['billing_summaries', 'bs_manager_facility', 'get_my_managed_facility_ids'],
  ['billing_event_participations', 'bep_manager_facility', 'get_my_managed_facility_ids'],
];

/* 131 前 (127/128/101 等) の書き方に特徴的な印。これが残っていれば「131 未適用」の決定的証拠 */
const LEGACY_MARK = /facility_id\s*=\s*\(\s*SELECT\s+employees\.facility_id/i;

await client.connect();
try {
  console.log('=== 1. ヘルパー関数の存在 (130 / 131 が定義するもの) ===');
  const fns = await client.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_my_facility_ids','get_my_managed_facility_ids','employee_belongs_to_facility',
                         'employee_in_my_managed_facilities','get_manager_subordinate_ids')
     order by p.proname`);
  const have = new Set(fns.rows.map(r => r.proname));
  for (const fn of ['get_my_facility_ids', 'get_my_managed_facility_ids', 'employee_belongs_to_facility',
    'employee_in_my_managed_facilities', 'get_manager_subordinate_ids']) {
    const src = fn === 'employee_in_my_managed_facilities' ? '131' : fn === 'get_manager_subordinate_ids' ? '131 が置換' : '130';
    console.log(`  ${have.has(fn) ? '✅ 有' : '❌ 無'}  ${fn}()  [${src}]`);
  }

  console.log('\n=== 2. employee_facilities テーブル (migration 130) ===');
  const tbl = await client.query(`
    select (select count(*) from information_schema.tables
             where table_schema='public' and table_name='employee_facilities')::int exists_t`);
  console.log(`  ${tbl.rows[0].exists_t ? '✅ 有' : '❌ 無'}  public.employee_facilities`);
  if (tbl.rows[0].exists_t) {
    const cnt = await client.query('select count(*)::int n from public.employee_facilities');
    console.log(`     行数 (兼任レコード): ${cnt.rows[0].n}`);
  }

  console.log('\n=== 3. get_manager_subordinate_ids() が 131 版 (兼任対応) か ===');
  const gmsi = await client.query(`
    select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='get_manager_subordinate_ids'`);
  if (!gmsi.rows[0]) console.log('  ❌ 関数が存在しない');
  else {
    const d = gmsi.rows[0].def;
    console.log(`  employee_facilities 参照: ${/employee_facilities/i.test(d) ? '✅ 有 → 131 版 (兼任対応)' : '❌ 無 → 131 前の版'}`);
  }

  console.log('\n=== 4. RLS policy 本体 (qual) の判定 ===');
  const rows = await client.query(`
    select tablename, policyname, cmd, qual, with_check
      from pg_policies where schemaname='public'
       and tablename in ('children','schedule_entries','shift_requests','shift_assignments',
                         'transport_assignments','shift_change_requests','facility_shift_settings',
                         'events','billing_summaries','billing_event_participations')
     order by tablename, policyname`);
  const byKey = new Map(rows.rows.map(r => [`${r.tablename}.${r.policyname}`, r]));

  let v131 = 0, vLegacy = 0, missing = 0;
  for (const [t, p, mark] of EXPECTED) {
    const r = byKey.get(`${t}.${p}`);
    if (!r) { console.log(`  ❌ 欠落   ${t}.${p}`); missing++; continue; }
    const body = `${r.qual ?? ''} ${r.with_check ?? ''}`;
    const is131 = body.includes(mark);
    const isLegacy = LEGACY_MARK.test(body);
    if (is131) { console.log(`  ✅ 131版  ${t}.${p} [${r.cmd}]  (${mark} を参照)`); v131++; }
    else if (isLegacy) { console.log(`  ⚠️ 旧版   ${t}.${p} [${r.cmd}]  (employees 直接サブクエリ = 127/128 版)`); vLegacy++; }
    else { console.log(`  ❓ 不明   ${t}.${p} [${r.cmd}]  qual=${(r.qual ?? '').slice(0, 120)}`); }
  }

  console.log('\n=== 5. 判定対象 policy の qual 全文 (証跡) ===');
  for (const [t, p] of EXPECTED) {
    const r = byKey.get(`${t}.${p}`);
    if (!r) continue;
    console.log(`\n-- ${t}.${p} [${r.cmd}]`);
    console.log(`   USING      : ${r.qual ?? '(null)'}`);
    if (r.with_check) console.log(`   WITH CHECK : ${r.with_check}`);
  }

  console.log('\n=== 6. 結論 ===');
  console.log(`  131版=${v131} / 旧(127・128)版=${vLegacy} / 欠落=${missing}  (期待 policy 数=${EXPECTED.length})`);
  if (v131 === EXPECTED.length) console.log('  → migration 131 は【適用済】。reference-map.md:35 の「未適用」が誤り。');
  else if (v131 === 0) console.log('  → migration 131 は【未適用】。reference-map.md:35 が正しい。');
  else console.log('  → 【部分適用】。131 の一部だけが本番に居る。要精査。');
} finally {
  await client.end();
}
