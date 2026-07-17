/* PDF/動画アップロードの現状調査:
   - documents / videos バケットの file_size_limit / allowed_mime_types の実値
   - 各バケットの最大格納オブジェクトサイズ (= グローバル upload 上限が効いているかの判定材料)
   - content_blocks 内に残る旧 Drive 動画/PDF ブロック件数 (移行漏れ) */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(projectRoot, '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean)
    .filter(l => !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const client = createPgClient(env);

const mb = (b) => b == null ? 'null' : `${(Number(b) / 1024 / 1024).toFixed(1)} MB (${b})`;

await client.connect();
try {
  console.log('=== storage.buckets (documents, videos) 現在値 ===');
  const b = await client.query(`
    SELECT id, public, file_size_limit, array_to_string(allowed_mime_types, ', ') AS mimes
      FROM storage.buckets WHERE id IN ('documents','videos') ORDER BY id;`);
  for (const r of b.rows) {
    console.log(`  [${r.id}] public=${r.public}`);
    console.log(`        file_size_limit = ${mb(r.file_size_limit)}`);
    console.log(`        allowed_mime    = ${r.mimes || '(null = 全許可)'}`);
  }

  console.log('\n=== 各バケットの オブジェクト件数 / 最大サイズ (metadata->>size) ===');
  const sizes = await client.query(`
    SELECT bucket_id,
           count(*) AS n,
           max((metadata->>'size')::bigint) AS max_size,
           sum((metadata->>'size')::bigint) AS total_size
      FROM storage.objects
     WHERE bucket_id IN ('documents','videos')
     GROUP BY bucket_id ORDER BY bucket_id;`);
  for (const r of sizes.rows) {
    console.log(`  [${r.bucket_id}] 件数=${r.n}  最大=${mb(r.max_size)}  合計=${mb(r.total_size)}`);
  }

  console.log('\n=== videos バケットの最大5件 (サイズ降順) ===');
  const top = await client.query(`
    SELECT name, (metadata->>'size')::bigint AS size, created_at
      FROM storage.objects WHERE bucket_id='videos'
     ORDER BY (metadata->>'size')::bigint DESC NULLS LAST LIMIT 5;`);
  for (const r of top.rows) console.log(`  ${mb(r.size)}  ${r.name}`);
  if (top.rowCount === 0) console.log('  (videos バケットに0件)');

  console.log('\n=== content_blocks に残る 旧 Drive / youtube ブロック (移行漏れ) ===');
  // manuals / trainings / announcements / compliance を横断
  for (const tbl of ['manuals', 'trainings', 'announcements', 'compliance']) {
    try {
      const q = await client.query(`
        SELECT count(*) AS rows_with_legacy
          FROM ${tbl}
         WHERE content_blocks::text ~ 'drive.google.com'
            OR content_blocks::text ~ '"source"\\s*:\\s*"google_drive"'
            OR content_blocks::text ~ '"source"\\s*:\\s*"youtube"';`);
      console.log(`  ${tbl}: 旧Drive/YouTube を含む行 = ${q.rows[0].rows_with_legacy}`);
    } catch (e) {
      console.log(`  ${tbl}: スキップ (${e.message.split('\n')[0]})`);
    }
  }
} finally {
  await client.end();
}
