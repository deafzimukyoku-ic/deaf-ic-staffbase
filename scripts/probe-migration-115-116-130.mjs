/* probe: reference-map.md が 131 と同じく「🆕 未適用」と記載している 115 / 116 / 130 の実 DB 状態を確認する。
   131 の調査中に、同じ台帳ブロックの他行も疑わしいと分かったため併せて事実確認する。
   接続は constraints.md §2 に従い pooler 経由。読み取り専用。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const client = createPgClient(env);

const tableExists = (t) => `(select count(*) from information_schema.tables where table_schema='public' and table_name='${t}')::int`;
const colExists = (t, c) => `(select count(*) from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}')::int`;

await client.connect();
try {
  console.log('=== 115_remove_departments_and_position_role.sql ===');
  console.log('  (A) departments 系テーブルが「消えている」ことが適用済の証拠');
  const r115 = await client.query(`select
    ${tableExists('departments')} departments,
    ${tableExists('employee_departments')} employee_departments,
    ${tableExists('manager_departments')} manager_departments,
    ${colExists('employees', 'department')} employees_department,
    ${colExists('positions', 'system_role')} positions_system_role`);
  const a = r115.rows[0];
  for (const [k, v] of Object.entries(a)) console.log(`   ${v === 0 ? '✅ 削除済' : '❌ 残存  '} ${k}`);
  console.log(`  → 115: ${Object.values(a).every(v => v === 0) ? '【適用済】' : '【未適用 or 部分適用】'}`);

  console.log('\n=== 116_facility_core_time_and_meta.sql ===');
  console.log('  (A) facility_shift_settings.core_start_time/core_end_time / (B) facilities の 3 列');
  const r116 = await client.query(`select
    ${colExists('facility_shift_settings', 'core_start_time')} core_start_time,
    ${colExists('facility_shift_settings', 'core_end_time')} core_end_time,
    ${colExists('facilities', 'display_order')} display_order,
    ${colExists('facilities', 'shift_enabled')} shift_enabled,
    ${colExists('facilities', 'transport_enabled')} transport_enabled`);
  const b = r116.rows[0];
  for (const [k, v] of Object.entries(b)) console.log(`   ${v === 1 ? '✅ 有' : '❌ 無'} ${k}`);
  console.log(`  → 116: ${Object.values(b).every(v => v === 1) ? '【適用済】' : '【未適用 or 部分適用】'}`);

  console.log('\n=== 130_employee_facilities.sql ===');
  const r130 = await client.query(`select
    ${tableExists('employee_facilities')} employee_facilities,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
        ('get_my_facility_ids','get_my_managed_facility_ids','employee_belongs_to_facility'))::int helpers,
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where not t.tgisinternal
        and t.tgname in ('employees_dedupe_primary_facility','ef_skip_primary_dup'))::int dup_triggers`);
  const c = r130.rows[0];
  console.log(`   ${c.employee_facilities === 1 ? '✅ 有' : '❌ 無'} employee_facilities テーブル`);
  console.log(`   ${c.helpers === 3 ? '✅' : '❌'} ヘルパー関数 ${c.helpers}/3`);
  console.log(`   ${c.dup_triggers >= 2 ? '✅' : '⚠️'} 重複防止トリガ ${c.dup_triggers} 本 (期待 2)`);
  console.log(`  → 130: ${c.employee_facilities === 1 && c.helpers === 3 ? '【適用済】' : '【未適用 or 部分適用】'}`);
} finally {
  await client.end();
}
