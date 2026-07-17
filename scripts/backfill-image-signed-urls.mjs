/* Phase 3-B: 既存 10 年 Signed URL の image ブロックを storage_path モデルへ変換
   docs/features/content-media-signed-url.md Phase 3 参照。

   既存画像は documents バケット内に物理的に存在し、content_blocks.image.url に
   `/storage/v1/object/sign/documents/<path>?token=...` の 10 年 Signed URL が
   入っている。BlockRenderer の新形式 (storage_path モデル) に揃えるため、
   url から path を逆抽出して storage_path に書き換える。物理移動は不要。

   実行: node scripts/backfill-image-signed-urls.mjs --dry-run
         node scripts/backfill-image-signed-urls.mjs --apply
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

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

const client = createPgClient(env);

const TABLES = ['manuals', 'trainings', 'announcements', 'compliance_documents'];

function extractStoragePathFromSignedUrl(u) {
  // https://<ref>.supabase.co/storage/v1/object/sign/documents/<path>?token=...
  // または      /storage/v1/object/public/documents/<path>
  const mm = (u || '').match(/\/storage\/v1\/object\/(?:sign|public)\/documents\/([^?]+)/);
  if (!mm) return null;
  try { return decodeURIComponent(mm[1]); } catch { return mm[1]; }
}

await client.connect();
const plan = [];
try {
  for (const table of TABLES) {
    const res = await client.query(
      `select id, content_blocks from public.${table}
        where content_blocks is not null
          and jsonb_array_length(content_blocks::jsonb) > 0;`
    );
    for (const r of res.rows) {
      const blocks = r.content_blocks;
      if (!Array.isArray(blocks)) continue;
      blocks.forEach((b, idx) => {
        if (b?.type !== 'image') return;
        if (b.storage_path) return; // 既移行
        const p = extractStoragePathFromSignedUrl(b.url);
        if (!p) return;
        plan.push({ table, row_id: r.id, blockIndex: idx, storagePath: p, oldUrl: b.url });
      });
    }
  }

  console.log('=== backfill-image-signed-urls ===');
  console.log(`mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY (本番)'}`);
  console.log(`バックフィル対象: ${plan.length} ブロック\n`);

  if (DRY_RUN) {
    fs.writeFileSync(
      path.resolve(projectRoot, 'docs', 'content-media-backfill-plan.json'),
      JSON.stringify({ snapshot_at: new Date().toISOString(), plan }, null, 2),
      'utf8',
    );
    console.log('plan を docs/content-media-backfill-plan.json に書き出しました');
    console.log('--apply で本番実行');
    process.exit(0);
  }

  let ok = 0;
  for (const item of plan) {
    const fresh = await client.query(
      `select content_blocks from public.${item.table} where id=$1;`,
      [item.row_id],
    );
    const blocks = fresh.rows[0]?.content_blocks;
    if (!Array.isArray(blocks)) {
      console.log(`SKIP ${item.table}/${item.row_id}: content_blocks gone`);
      continue;
    }
    const oldBlock = blocks[item.blockIndex];
    if (oldBlock?.type !== 'image') {
      console.log(`SKIP ${item.table}/${item.row_id}/blocks[${item.blockIndex}]: not image`);
      continue;
    }
    blocks[item.blockIndex] = {
      type: 'image',
      storage_path: item.storagePath,
      ...(oldBlock.caption ? { caption: oldBlock.caption } : {}),
    };
    await client.query(
      `update public.${item.table} set content_blocks = $1::jsonb where id = $2;`,
      [JSON.stringify(blocks), item.row_id],
    );
    console.log(`OK ${item.table}/${item.row_id}/blocks[${item.blockIndex}] → ${item.storagePath}`);
    ok++;
  }
  console.log(`\n完了: ${ok} 件更新`);
} finally {
  await client.end();
}
