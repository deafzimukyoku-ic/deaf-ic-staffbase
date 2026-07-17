/* Phase 3-A: 既存の Drive 動画/PDF を Supabase Storage に全件移行
   docs/features/content-media-signed-url.md Phase 3
   + content-media-parity-with-diletto.md Phase C 参照。

   処理:
     1. 4 テーブル (manuals/trainings/announcements/compliance_documents)
        の content_blocks を全件走査
     2. video (source!=youtube) / pdf type に対応する Drive 共有 URL を抽出
     3. 各 fileId について:
        a. drive.usercontent.google.com からダウンロード (mp4/pdf を想定)
        b. tenant_id を行から取得して buildStoragePath 相当でパス生成
        c. Supabase Storage に service-role で put
           - 動画 → videos バケット (path: videos/{tenant}/...、500 MB / video MIME 限定)
           - PDF  → documents バケット (path: {prefix}/{tenant}/...、200 MB)
        d. content_blocks 内の該当 block を {type, source:'storage', storage_path}
           に書き換え
        e. テーブル行を UPDATE
     4. 失敗行はリストとして残し、後追い手動対応可能にする

   実行: node scripts/migrate-drive-to-storage.mjs --dry-run   (計画のみ)
         node scripts/migrate-drive-to-storage.mjs --apply     (本番実行)
*/
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createClient } from '@supabase/supabase-js';

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

const pgClient = createPgClient(env);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? `https://${ref}.supabase.co`;
const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRole) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
const sb = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

const TABLES = [
  { table: 'manuals', label: 'マニュアル', storagePrefix: 'manuals' },
  { table: 'trainings', label: '研修', storagePrefix: 'trainings' },
  { table: 'announcements', label: 'お知らせ', storagePrefix: 'announcements' },
  { table: 'compliance_documents', label: '遵守事項', storagePrefix: 'compliance' },
];

function extractDriveFileId(u) {
  const match = (u || '').match(/\/file\/d\/([\w-]+)/);
  return match ? match[1] : null;
}

function isYoutubeUrl(u) {
  return /(?:youtube\.com|youtu\.be)/i.test(u || '');
}

const ASCII_SAFE = /[a-zA-Z0-9._-]/;
function sanitizeFilenameAscii(s) {
  const arr = Array.from(s).map((ch) => (ASCII_SAFE.test(ch) ? ch : '_')).join('');
  const collapsed = arr.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return collapsed || 'file';
}

function buildStoragePath(prefix, tenantId, ext) {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);
  const name = sanitizeFilenameAscii(`migrated_${ts}_${rnd}`) + (ext ? `.${ext}` : '');
  return `${prefix}/${tenantId}/${ts}_${rnd}_${name}`;
}

async function downloadDriveFile(fileId) {
  const u = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`fetch failed ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    throw new Error('Drive returned HTML (access denied or private file)');
  }
  const buf = Buffer.from(await r.arrayBuffer());
  return { buffer: buf, contentType: ct, size: buf.length };
}

function extToFromContentType(ct) {
  if (!ct) return null;
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('quicktime')) return 'mov';
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  return null;
}

await pgClient.connect();
const plan = []; // { table, row_id, tenant_id, blockIndex, blockType, fileId, oldUrl, ... }
const failures = [];

try {
  for (const { table, label, storagePrefix } of TABLES) {
    const res = await pgClient.query(
      `select id, tenant_id, content_blocks from public.${table}
        where content_blocks is not null
          and jsonb_array_length(content_blocks::jsonb) > 0;`
    );
    for (const r of res.rows) {
      const blocks = r.content_blocks;
      if (!Array.isArray(blocks)) continue;
      blocks.forEach((b, idx) => {
        if (!b || !b.type) return;
        if (b.type === 'video') {
          if (b.source === 'storage' && b.storage_path) return; // 既移行
          if (isYoutubeUrl(b.url)) return; // YouTube は移行不要
          const fileId = extractDriveFileId(b.url || '');
          if (!fileId) return;
          plan.push({ table, label, row_id: r.id, tenant_id: r.tenant_id, blockIndex: idx, blockType: 'video', fileId, oldUrl: b.url, storagePrefix });
        } else if (b.type === 'pdf') {
          if (b.source === 'storage' && b.storage_path) return;
          const fileId = extractDriveFileId(b.url || '');
          if (!fileId) return;
          plan.push({ table, label, row_id: r.id, tenant_id: r.tenant_id, blockIndex: idx, blockType: 'pdf', fileId, oldUrl: b.url, storagePrefix });
        }
      });
    }
  }

  console.log('=== migrate-drive-to-storage ===');
  console.log(`mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY (本番)'}`);
  console.log(`移行対象: ${plan.length} ブロック\n`);
  const byTable = plan.reduce((acc, p) => { acc[p.label] = (acc[p.label] ?? 0) + 1; return acc; }, {});
  for (const [label, n] of Object.entries(byTable)) console.log(`  ${label}: ${n}`);
  console.log('');

  if (DRY_RUN) {
    console.log('[dry-run] 実行プランを docs/content-media-migration-plan.json に書き出します');
    fs.writeFileSync(
      path.resolve(projectRoot, 'docs', 'content-media-migration-plan.json'),
      JSON.stringify({ snapshot_at: new Date().toISOString(), plan }, null, 2),
      'utf8',
    );
    console.log(`done. --apply で本番実行`);
    process.exit(0);
  }

  console.log('=== APPLY: Drive → Storage 一括移行開始 ===\n');
  let ok = 0;
  for (const item of plan) {
    const tag = `[${item.label}/${item.row_id}/blocks[${item.blockIndex}]]`;
    process.stdout.write(`${tag} ${item.blockType} ${item.fileId} ... `);
    try {
      const dl = await downloadDriveFile(item.fileId);
      /* Drive は PDF を application/octet-stream で返すことが多い。block.type で
         本来の MIME を確定させてバケット allowed_mime_types を通す。 */
      const isVideo = item.blockType === 'video';
      const enforcedContentType = isVideo
        ? (dl.contentType && /^video\//.test(dl.contentType) ? dl.contentType : 'video/mp4')
        : 'application/pdf';
      const ext = isVideo ? (extToFromContentType(enforcedContentType) || 'mp4') : 'pdf';
      /* 動画は videos バケット (videos/{tenant}/...) / PDF は documents バケット ({prefix}/{tenant}/...) */
      const bucket = isVideo ? 'videos' : 'documents';
      const prefix = isVideo ? 'videos' : item.storagePrefix;
      const storagePath = buildStoragePath(prefix, item.tenant_id, ext);

      const { error: upErr } = await sb.storage.from(bucket).upload(storagePath, dl.buffer, {
        contentType: enforcedContentType,
        upsert: false,
      });
      if (upErr) throw new Error(`storage upload failed (${bucket}, ${(dl.size/1024/1024).toFixed(1)}MB): ${upErr.message}`);

      // content_blocks の該当 block を更新 (atomic に行全体を再書込)
      const fresh = await pgClient.query(
        `select content_blocks from public.${item.table} where id=$1;`,
        [item.row_id],
      );
      const blocks = fresh.rows[0]?.content_blocks;
      if (!Array.isArray(blocks)) throw new Error('content_blocks gone after select');
      const oldBlock = blocks[item.blockIndex];
      if (!oldBlock || oldBlock.type !== item.blockType) throw new Error('block index mismatch');
      const newBlock = {
        type: item.blockType,
        source: 'storage',
        storage_path: storagePath,
        ...(item.blockType === 'pdf' && oldBlock.label ? { label: oldBlock.label } : {}),
      };
      blocks[item.blockIndex] = newBlock;
      await pgClient.query(
        `update public.${item.table} set content_blocks = $1::jsonb where id = $2;`,
        [JSON.stringify(blocks), item.row_id],
      );
      console.log(`OK (${(dl.size/1024/1024).toFixed(1)} MB → ${storagePath})`);
      ok++;
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
      failures.push({ ...item, error: e.message });
    }
  }
  console.log(`\n完了: 成功 ${ok} / 失敗 ${failures.length}`);
  if (failures.length > 0) {
    fs.writeFileSync(
      path.resolve(projectRoot, 'docs', 'content-media-migration-failures.json'),
      JSON.stringify({ snapshot_at: new Date().toISOString(), failures }, null, 2),
      'utf8',
    );
    console.log('失敗リスト: docs/content-media-migration-failures.json');
  }
} finally {
  await pgClient.end();
}
