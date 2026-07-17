/* shift_manager の児童・職員編集権限調査用
   - public.employees / public.children の RLS policy を実 DB から取得
   - manager / shift_manager が UPDATE/INSERT できる条件を確認
   - RLS ヘルパー関数 (get_my_role / get_my_managed_facility_ids) の定義を確認 */
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
  for (const tbl of ['employees', 'children']) {
    console.log(`\n=== public.${tbl} RLS policies ===`);
    const pols = await client.query(`
      SELECT polname,
             CASE polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                         WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                         WHEN '*' THEN 'ALL' END AS cmd,
             pg_get_expr(polqual, polrelid) AS using_expr,
             pg_get_expr(polwithcheck, polrelid) AS check_expr
        FROM pg_policy WHERE polrelid = ('public.' || $1)::regclass
        ORDER BY polcmd, polname;`, [tbl]);
    for (const r of pols.rows) {
      console.log(`  - ${r.polname} [${r.cmd}]`);
      if (r.using_expr) console.log(`      USING: ${r.using_expr}`);
      if (r.check_expr) console.log(`      CHECK: ${r.check_expr}`);
    }
  }

  console.log('\n=== RLS ヘルパー関数定義 ===');
  const fns = await client.query(`
    SELECT proname, pg_get_functiondef(oid) AS def
      FROM pg_proc
     WHERE proname IN ('get_my_role', 'get_my_managed_facility_ids')
       AND pronamespace = 'public'::regnamespace;`);
  for (const r of fns.rows) console.log(`\n--- ${r.proname} ---\n${r.def}`);
} finally {
  await client.end();
}
