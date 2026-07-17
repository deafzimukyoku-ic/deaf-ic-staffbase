/* 400 を返している signed URL のパスが
   - manuals テーブルのどの行を指しているか
   - documents バケットに実在するか
   を確認するワンショット probe。読み取り専用。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const STORAGE_PATH = 'manuals/a899a744-deeb-41b6-9cad-68d27bb6fbac/1779848407962_yqppqj_migrated_1779848407962_yqppqj.pdf';
const TENANT_ID = 'a899a744-deeb-41b6-9cad-68d27bb6fbac';
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

console.log('=== probing path ===');
console.log(`bucket: documents`);
console.log(`path  : ${STORAGE_PATH}`);
console.log(`url   : ${SUPABASE_URL}`);
console.log('');

const client = createPgClient(env);
await client.connect();
try {
  /* 1) どの manuals row が このパスを参照しているか */
  console.log('--- DB lookup (manuals) ---');
  const r1 = await client.query(`
    SELECT id, title, pdf_storage_path, tenant_id, updated_at
      FROM public.manuals
     WHERE pdf_storage_path LIKE '%' || $1 || '%'
        OR content_blocks::text LIKE '%' || $1 || '%'`,
    ['1779848407962_yqppqj_migrated_1779848407962_yqppqj']);
  console.log(`hits: ${r1.rowCount}`);
  for (const r of r1.rows) {
    console.log(`  manual ${r.id} "${r.title}"`);
    console.log(`    tenant=${r.tenant_id} updated=${r.updated_at}`);
    console.log(`    pdf_storage_path=${r.pdf_storage_path}`);
  }
  /* content_blocks の中身も覗く */
  if (r1.rowCount > 0) {
    const r2 = await client.query(`
      SELECT id, title, jsonb_pretty(content_blocks) AS cb
        FROM public.manuals WHERE id = $1`, [r1.rows[0].id]);
    console.log(`\n--- content_blocks (manual ${r1.rows[0].id}) ---`);
    console.log(r2.rows[0].cb);
  }
} finally {
  await client.end();
}

/* 2) Storage API で実在確認 */
console.log('\n--- storage HEAD (admin / service role) ---');
const folder = STORAGE_PATH.substring(0, STORAGE_PATH.lastIndexOf('/'));
const fname = STORAGE_PATH.substring(STORAGE_PATH.lastIndexOf('/') + 1);
const listUrl = `${SUPABASE_URL}/storage/v1/object/list/documents`;
const listRes = await fetch(listUrl, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefix: folder, limit: 200 }),
});
const listJson = await listRes.json();
console.log(`list ${listUrl} → ${listRes.status}`);
if (Array.isArray(listJson)) {
  console.log(`files under "${folder}" :`);
  const hit = listJson.find(f => f.name === fname);
  for (const f of listJson) console.log(`  ${f.name === fname ? '★' : ' '} ${f.name} (${f.metadata?.size ?? '?'} B)`);
  console.log(`\nresult: ${hit ? 'FOUND ★' : 'NOT FOUND (= 400 の根本原因)'}`);
} else {
  console.log('list response:', JSON.stringify(listJson, null, 2));
}

/* 3) 直接ファイルメタを HEAD */
const headUrl = `${SUPABASE_URL}/storage/v1/object/info/documents/${STORAGE_PATH}`;
const headRes = await fetch(headUrl, {
  headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
});
console.log(`\nHEAD ${headUrl}\n  → ${headRes.status} ${headRes.statusText}`);
if (headRes.ok) {
  const info = await headRes.json();
  console.log('  info:', JSON.stringify(info));
}
