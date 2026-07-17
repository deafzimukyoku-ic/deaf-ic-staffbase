/* 過去にアップロード成功している announcements の image URL を見て、path 構造を確認 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const client = createPgClient(env);
await client.connect();
try {
  const q = await client.query(`
    WITH blocks AS (
      SELECT id, title, created_at, jsonb_array_elements(content_blocks) AS b
        FROM public.announcements
       WHERE jsonb_typeof(content_blocks)='array'
    )
    SELECT id, title, created_at, b->>'url' AS url
      FROM blocks WHERE b->>'type'='image';
  `);
  console.log('=== announcements images (4) ===');
  for (const r of q.rows) {
    console.log(`\n  ${r.created_at?.toISOString?.()}  "${r.title}"`);
    const u = r.url || '';
    // signed url か public url か判別 + path 抽出
    let mPath = u.match(/\/storage\/v1\/object\/(?:sign|public)\/documents\/([^?]+)/);
    if (mPath) {
      const objectPath = mPath[1];
      const parts = objectPath.split('/');
      console.log(`    object path: ${objectPath}`);
      console.log(`    folder[1]:   ${parts[0]}`);
      console.log(`    folder[2]:   ${parts[1] ?? '(none)'}`);
    } else {
      console.log(`    raw url: ${u.slice(0,200)}`);
    }
  }

  console.log('\n=== documents バケット内 全オブジェクトのパス先頭分布 ===');
  const dist = await client.query(`
    SELECT (storage.foldername(name))[1] AS folder1, count(*) AS n
      FROM storage.objects WHERE bucket_id='documents'
     GROUP BY 1 ORDER BY 2 DESC;
  `);
  for (const r of dist.rows) console.log(`  ${r.folder1}: ${r.n} objects`);
} finally { await client.end(); }
