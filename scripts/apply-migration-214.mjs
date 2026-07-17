/* migration 214 (shift_manager 職員編集 RPC 2本) を本番 DB に適用 + 検証 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(projectRoot, '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const sql = fs.readFileSync(
  path.resolve(projectRoot, 'supabase', 'migrations', '214_shift_manager_staff_edit_rpc.sql'),
  'utf8'
);

const client = createPgClient(env);

await client.connect();
try {
  console.log('--- applying migration 214 ---');
  await client.query(sql);
  console.log('--- applied ---\n');

  console.log('=== verify: RPC 関数の存在 ===');
  const p = await client.query(`
    SELECT proname,
           pg_get_function_identity_arguments(oid) AS args,
           prosecdef AS security_definer
      FROM pg_proc
     WHERE proname IN ('update_staff_shift_fields', 'reorder_staff_shift_orders')
       AND pronamespace = 'public'::regnamespace
     ORDER BY proname;`);
  for (const r of p.rows) {
    console.log(`  - ${r.proname}(${r.args})  security_definer=${r.security_definer}`);
  }
  if (p.rowCount !== 2) throw new Error(`expected 2 functions, got ${p.rowCount}`);
  if (!p.rows.every((r) => r.security_definer)) throw new Error('SECURITY DEFINER が付いていない関数があります');

  console.log('\nOK: 職員シフト編集 RPC 2 本が反映されました');
} finally {
  await client.end();
}
