/* バグ調査 SQL: ①マネージャー投稿エラー ②「7/6」分子>分母 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.resolve(projectRoot, '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const client = createPgClient(env);

await client.connect();
try {
  console.log('\n===== バグ②: document_templates のカラム全部 =====');
  const dtCols = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='document_templates'
    ORDER BY ordinal_position
  `);
  for (const r of dtCols.rows) console.log(' ', r.column_name, '|', r.data_type);

  console.log('\n===== バグ②: document_template_audience の中身（先頭5件） =====');
  const dta = await client.query(`
    SELECT template_id, rule_type, rule_value FROM document_template_audience LIMIT 5
  `).catch(e => ({ rows: [], err: e.message }));
  if (dta.err) console.log('  (err:', dta.err, ')');
  else for (const r of dta.rows) console.log(`  template=${r.template_id} rule=${r.rule_type}:${r.rule_value}`);

  console.log('\n===== バグ②: docs_submitted 上位 + テンプレ総数 =====');
  const overSubmit = await client.query(`
    SELECT
      ep.employee_id::text AS eid,
      (e.last_name || e.first_name) AS name,
      e.facility_id::text AS fac,
      ep.docs_submitted::int AS submitted,
      (SELECT count(*)::int FROM document_templates dt WHERE dt.tenant_id = ep.tenant_id) AS tpl_total,
      (SELECT count(*)::int FROM document_template_audience dta
         WHERE dta.template_id IN (SELECT id FROM document_templates WHERE tenant_id = ep.tenant_id)) AS audience_rules
    FROM employee_progress ep
    JOIN employees e ON e.id = ep.employee_id
    WHERE ep.docs_submitted > 0
    ORDER BY ep.docs_submitted DESC
    LIMIT 15
  `);
  for (const r of overSubmit.rows) {
    console.log(`  ${r.name.padEnd(20)} submitted=${r.submitted} / tpl_total=${r.tpl_total}${r.submitted > r.tpl_total ? ' ⚠️' : ''}`);
  }

  console.log('\n===== バグ①: RLS ポリシー (manager 関連) =====');
  const policies = await client.query(`
    SELECT c.relname AS tablename, p.polname,
      CASE p.polcmd WHEN 'a' THEN 'INSERT' WHEN 'r' THEN 'SELECT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END AS cmd,
      substring(pg_get_expr(p.polqual, p.polrelid) for 250) AS using_expr,
      substring(pg_get_expr(p.polwithcheck, p.polrelid) for 250) AS check_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('announcements','compliance_documents','trainings','manuals')
      AND p.polname ILIKE '%manager%'
    ORDER BY c.relname, p.polname
  `);
  for (const r of policies.rows) {
    console.log(`  [${r.tablename}] ${r.polname} (${r.cmd})`);
    console.log(`    USING:`, r.using_expr);
    if (r.check_expr) console.log(`    CHECK:`, r.check_expr);
  }

  console.log('\n===== バグ①: manager の manager_facilities 登録状況 =====');
  const mgrs = await client.query(`
    SELECT e.id::text AS eid, (e.last_name||e.first_name) AS name,
      count(mf.facility_id)::int AS managed_count
    FROM employees e
    LEFT JOIN manager_facilities mf ON mf.employee_id = e.id
    WHERE e.role='manager' AND e.status='active'
    GROUP BY e.id, e.last_name, e.first_name
    ORDER BY managed_count, name
  `);
  console.log(' 件数:', mgrs.rows.length);
  for (const r of mgrs.rows) {
    const mark = r.managed_count === 0 ? ' ⚠️ 未登録!' : '';
    console.log(`  ${r.name.padEnd(20)} managed=${r.managed_count}${mark}`);
  }
} finally {
  await client.end();
}
