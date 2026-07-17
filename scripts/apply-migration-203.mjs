/* migration 203 (docs_submitted audience-aware) を pooler 経由で適用 */
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
const migrationSql = fs.readFileSync(path.resolve(projectRoot, 'supabase', 'migrations', '203_docs_submitted_audience_aware.sql'), 'utf8');

const client = createPgClient(env);

await client.connect();
try {
  console.log('[BEFORE] 異常社員（docs_submitted > 7）:');
  const before = await client.query(`
    SELECT e.last_name||e.first_name AS name, ep.docs_submitted
    FROM employee_progress ep
    JOIN employees e ON e.id = ep.employee_id
    WHERE ep.docs_submitted > 0
    ORDER BY ep.docs_submitted DESC LIMIT 10
  `);
  for (const r of before.rows) console.log(`  ${r.name.padEnd(20)} ${r.docs_submitted}`);

  console.log('\n--- applying migration 203 ---');
  await client.query(migrationSql);
  console.log('--- migration 203 applied ---\n');

  console.log('[AFTER] 同じ社員の docs_submitted:');
  const after = await client.query(`
    SELECT e.last_name||e.first_name AS name, ep.docs_submitted
    FROM employee_progress ep
    JOIN employees e ON e.id = ep.employee_id
    WHERE ep.docs_submitted > 0
    ORDER BY ep.docs_submitted DESC LIMIT 10
  `);
  for (const r of after.rows) console.log(`  ${r.name.padEnd(20)} ${r.docs_submitted}`);

  console.log('\n[AFTER] document_template_in_audience() 動作確認:');
  const fnTest = await client.query(`
    SELECT public.document_template_in_audience(
      (SELECT id FROM document_templates LIMIT 1),
      (SELECT id FROM employees WHERE status='active' LIMIT 1)
    ) AS result
  `);
  console.log('  関数結果:', fnTest.rows[0].result);
} finally {
  await client.end();
}
