/* migration 207 (storage documents RLS) を本番 DB に適用 + 検証 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(projectRoot, '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));

const sql = fs.readFileSync(
  path.resolve(projectRoot, 'supabase', 'migrations', '207_storage_documents_rls_fix.sql'),
  'utf8'
);

const client = createPgClient(env);

await client.connect();
try {
  console.log('--- applying migration 207 ---');
  await client.query(sql);
  console.log('--- applied ---\n');

  console.log('=== verify: storage.objects policies for documents ===');
  const pols = await client.query(`
    SELECT polname,
           CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                       WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                       WHEN '*' THEN 'ALL' END AS cmd
      FROM pg_policy
     WHERE polrelid='storage.objects'::regclass
       AND polname LIKE 'documents:%'
     ORDER BY polname;
  `);
  for (const r of pols.rows) console.log(`  - ${r.polname} [${r.cmd}]`);

  if (!pols.rows.find(r => r.polname === 'documents: tenant members can read')) {
    throw new Error('expected read policy not present');
  }
  if (!pols.rows.find(r => r.polname === 'documents: admin or manager can manage')) {
    throw new Error('expected write policy not present');
  }
  console.log('\nOK: 期待する 2 ポリシーが存在');
} finally {
  await client.end();
}
