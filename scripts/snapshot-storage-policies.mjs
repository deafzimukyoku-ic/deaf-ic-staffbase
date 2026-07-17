/* deaf-ic 本番 DB の storage policy を JSON で dump → docs/storage-policy-snapshot.json に保存
 *
 * 目的: Supabase Dashboard で policy が手動編集された場合と migration ファイルで定義した状態の
 *      ギャップを検出可能にする。RLS 系変更前に必ずこの snapshot を取って、変更後の snapshot を
 *      git diff で残すこと。
 *
 * 使い方: node scripts/snapshot-storage-policies.mjs
 *   → docs/storage-policy-snapshot.json を上書き保存
 *   → git diff docs/storage-policy-snapshot.json で変更点を確認
 */
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
  // storage.buckets の状態 (file_size_limit / mime_types / public)
  const buckets = await client.query(`
    SELECT id, name, public, file_size_limit,
           COALESCE(allowed_mime_types, ARRAY[]::text[]) AS allowed_mime_types
      FROM storage.buckets
     ORDER BY id;
  `);

  // storage.objects の全 policy
  const policies = await client.query(`
    SELECT polname,
           CASE polcmd
             WHEN 'r' THEN 'SELECT'
             WHEN 'a' THEN 'INSERT'
             WHEN 'w' THEN 'UPDATE'
             WHEN 'd' THEN 'DELETE'
             WHEN '*' THEN 'ALL'
           END AS cmd,
           array_to_string(ARRAY(
             SELECT rolname FROM pg_roles WHERE oid = ANY(polroles)
           ), ',') AS roles,
           pg_get_expr(polqual, polrelid) AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS check_expr
      FROM pg_policy
     WHERE polrelid = 'storage.objects'::regclass
     ORDER BY polname, polcmd;
  `);

  // RLS の有効状態
  const rls = await client.query(`
    SELECT relrowsecurity AS rls_enabled,
           relforcerowsecurity AS rls_forced
      FROM pg_class
     WHERE oid = 'storage.objects'::regclass;
  `);

  const snapshot = {
    snapshot_at: new Date().toISOString(),
    note: '本番 DB の storage.* RLS 現状。migration ファイルとの差分検知用。Dashboard での手動編集を検出する目的。',
    storage_objects_rls: rls.rows[0] ?? null,
    buckets: buckets.rows,
    policies: policies.rows.map(p => ({
      polname: p.polname,
      cmd: p.cmd,
      roles: p.roles,
      using: p.using_expr,
      with_check: p.check_expr,
    })),
  };

  const outPath = path.resolve(projectRoot, 'docs', 'storage-policy-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
  console.log(`  buckets:  ${snapshot.buckets.length}`);
  console.log(`  policies: ${snapshot.policies.length}`);
} finally {
  await client.end();
}
