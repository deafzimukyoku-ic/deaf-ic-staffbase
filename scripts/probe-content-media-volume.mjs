/* content-media-signed-url 仕様の Phase 0 調査。
   4 テーブル (manuals / trainings / announcements / compliance_documents) の
   content_blocks (jsonb[]) を全件走査し、video/pdf/image の数 + URL 種別を集計。

   出力:
   - 各テーブルの video/pdf/image 件数
   - Drive fileId のユニーク数 + リスト (移行対象)
   - 既存 Supabase Storage signed URL の検出 (path 抽出可否)
   - Pro プラン Storage 100GB 枠への充足見積もり (Drive ファイル単位サイズは別途 HEAD で取得)
*/
import pg from 'pg';
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
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) throw new Error('DATABASE_URL parse fail (expected db.<ref>.supabase.co form)');
const password = decodeURIComponent(m[2]);
const ref = m[3];

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${ref}`,
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

const TABLES = [
  { table: 'manuals', label: 'マニュアル' },
  { table: 'trainings', label: '研修' },
  { table: 'announcements', label: 'お知らせ' },
  { table: 'compliance_documents', label: '遵守事項' },
];

function classifyUrl(u) {
  if (!u || typeof u !== 'string') return 'empty';
  if (/drive\.google\.com\/file\/d\/([\w-]+)/.test(u)) return 'drive';
  if (/(youtube\.com|youtu\.be)/.test(u)) return 'youtube';
  if (/supabase\.co\/storage\/v1\/object\/sign\//.test(u)) return 'storage_signed';
  if (/supabase\.co\/storage\/v1\/object\/public\//.test(u)) return 'storage_public';
  return 'other';
}

function extractDriveFileId(u) {
  const match = (u || '').match(/\/file\/d\/([\w-]+)/);
  return match ? match[1] : null;
}

function extractStoragePath(u) {
  // Supabase storage signed URL: https://<ref>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=...
  // または public URL: https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
  const m = (u || '').match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/);
  if (!m) return null;
  return { bucket: m[1], path: decodeURIComponent(m[2]) };
}

const summary = {
  by_table: {},
  drive_video_ids: new Set(),
  drive_pdf_ids: new Set(),
  storage_image_paths: new Set(),
  storage_signed_count: 0,
  storage_public_count: 0,
  other_count: 0,
  youtube_count: 0,
};

await client.connect();
try {
  for (const { table, label } of TABLES) {
    // テーブル存在チェック (compliance_documents が compliance_docs だった場合のフォールバック用)
    const tExists = await client.query(
      `select 1 from information_schema.tables where table_schema='public' and table_name=$1 limit 1`,
      [table],
    );
    if (tExists.rowCount === 0) {
      console.warn(`[skip] table not found: ${table}`);
      continue;
    }

    const res = await client.query(`
      select id, tenant_id, content_blocks
        from public.${table}
       where content_blocks is not null
         and jsonb_array_length(content_blocks::jsonb) > 0;
    `);

    const stat = {
      total_rows: res.rowCount,
      video: { drive: 0, youtube: 0, storage_signed: 0, storage_public: 0, other: 0, empty: 0 },
      pdf:   { drive: 0, youtube: 0, storage_signed: 0, storage_public: 0, other: 0, empty: 0 },
      image: { drive: 0, youtube: 0, storage_signed: 0, storage_public: 0, other: 0, empty: 0 },
      drive_fileids: [],
      drive_pdf_fileids: [],
      storage_image_paths: [],
    };

    for (const r of res.rows) {
      const blocks = Array.isArray(r.content_blocks) ? r.content_blocks : (r.content_blocks?.length ? r.content_blocks : []);
      for (const b of blocks) {
        if (!b || !b.type) continue;
        if (b.type === 'video') {
          const cls = classifyUrl(b.url);
          stat.video[cls]++;
          if (cls === 'drive') {
            const id = extractDriveFileId(b.url);
            if (id) {
              stat.drive_fileids.push({ table, row_id: r.id, fileId: id });
              summary.drive_video_ids.add(id);
            }
          } else if (cls === 'storage_signed') summary.storage_signed_count++;
          else if (cls === 'storage_public') summary.storage_public_count++;
          else if (cls === 'youtube') summary.youtube_count++;
          else if (cls === 'other') summary.other_count++;
        } else if (b.type === 'pdf') {
          const cls = classifyUrl(b.url);
          stat.pdf[cls]++;
          if (cls === 'drive') {
            const id = extractDriveFileId(b.url);
            if (id) {
              stat.drive_pdf_fileids.push({ table, row_id: r.id, fileId: id });
              summary.drive_pdf_ids.add(id);
            }
          } else if (cls === 'storage_signed') summary.storage_signed_count++;
          else if (cls === 'storage_public') summary.storage_public_count++;
          else if (cls === 'other') summary.other_count++;
        } else if (b.type === 'image') {
          const cls = classifyUrl(b.url);
          stat.image[cls]++;
          if (cls === 'storage_signed' || cls === 'storage_public') {
            const sp = extractStoragePath(b.url);
            if (sp) {
              stat.storage_image_paths.push({ table, row_id: r.id, bucket: sp.bucket, path: sp.path });
              summary.storage_image_paths.add(`${sp.bucket}/${sp.path}`);
              if (cls === 'storage_signed') summary.storage_signed_count++;
              else summary.storage_public_count++;
            }
          } else if (cls === 'drive') stat.image.drive++;
          else if (cls === 'other') summary.other_count++;
        }
      }
    }
    summary.by_table[label] = stat;
  }

  // 結果表示
  console.log('\n============================================================');
  console.log('  content-media-signed-url Phase 0 調査結果');
  console.log('============================================================\n');

  for (const { label } of TABLES) {
    const s = summary.by_table[label];
    if (!s) continue;
    console.log(`■ ${label} (rows: ${s.total_rows})`);
    console.log(`  video : drive=${s.video.drive} youtube=${s.video.youtube} storage_signed=${s.video.storage_signed} storage_public=${s.video.storage_public} other=${s.video.other}`);
    console.log(`  pdf   : drive=${s.pdf.drive} storage_signed=${s.pdf.storage_signed} storage_public=${s.pdf.storage_public} other=${s.pdf.other}`);
    console.log(`  image : drive=${s.image.drive} storage_signed=${s.image.storage_signed} storage_public=${s.image.storage_public} other=${s.image.other}`);
    console.log('');
  }

  console.log('-- 集計 (移行対象) ---------------------------------');
  console.log(`Drive 動画 (ユニーク fileId): ${summary.drive_video_ids.size}`);
  console.log(`Drive PDF  (ユニーク fileId): ${summary.drive_pdf_ids.size}`);
  console.log(`既存 Storage 画像 (ユニーク path): ${summary.storage_image_paths.size}`);
  console.log(`Storage signed URL 検出: ${summary.storage_signed_count}`);
  console.log(`Storage public URL 検出: ${summary.storage_public_count}`);
  console.log(`YouTube 動画: ${summary.youtube_count}`);
  console.log(`その他 URL: ${summary.other_count}`);

  // JSON 出力 (移行スクリプトで再利用)
  const out = {
    snapshot_at: new Date().toISOString(),
    drive_video_ids: [...summary.drive_video_ids],
    drive_pdf_ids: [...summary.drive_pdf_ids],
    storage_image_paths: [...summary.storage_image_paths],
    per_row_drive_video: TABLES.flatMap(({ label }) => summary.by_table[label]?.drive_fileids ?? []),
    per_row_drive_pdf: TABLES.flatMap(({ label }) => summary.by_table[label]?.drive_pdf_fileids ?? []),
    per_row_storage_image: TABLES.flatMap(({ label }) => summary.by_table[label]?.storage_image_paths ?? []),
    counts: {
      drive_video_unique: summary.drive_video_ids.size,
      drive_pdf_unique: summary.drive_pdf_ids.size,
      storage_image_unique: summary.storage_image_paths.size,
      storage_signed_total: summary.storage_signed_count,
      storage_public_total: summary.storage_public_count,
      youtube_total: summary.youtube_count,
      other_total: summary.other_count,
    },
  };
  const outPath = path.resolve(projectRoot, 'docs', 'content-media-volume-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n結果 JSON: docs/content-media-volume-snapshot.json (${out.per_row_drive_video.length + out.per_row_drive_pdf.length + out.per_row_storage_image.length} 行)`);

  // 推定容量見積もり (Drive ファイルサイズ取得)
  if (summary.drive_video_ids.size > 0 || summary.drive_pdf_ids.size > 0) {
    console.log('\n-- Drive ファイルサイズ HEAD 取得 (推定容量) --');
    const allIds = [
      ...[...summary.drive_video_ids].map(id => ({ id, kind: 'video' })),
      ...[...summary.drive_pdf_ids].map(id => ({ id, kind: 'pdf' })),
    ];
    let totalBytes = 0;
    let failedCount = 0;
    for (const { id, kind } of allIds) {
      try {
        const r = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0&confirm=t`, {
          method: 'HEAD',
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'follow',
        });
        const len = Number(r.headers.get('content-length') || '0');
        if (len > 0) {
          totalBytes += len;
          console.log(`  ${kind} ${id}: ${(len / 1024 / 1024).toFixed(1)} MB`);
        } else {
          failedCount++;
          console.log(`  ${kind} ${id}: 取得不可 (private or scan warning)`);
        }
      } catch (e) {
        failedCount++;
        console.log(`  ${kind} ${id}: error ${e.message}`);
      }
    }
    console.log(`\n推定合計サイズ: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Supabase Pro Storage 100 GB 枠に対する充足率: ${(totalBytes / (100 * 1024 * 1024 * 1024) * 100).toFixed(3)}%`);
    if (failedCount > 0) console.log(`サイズ取得不可: ${failedCount} 件 (移行スクリプトで個別対応)`);
  }
} finally {
  await client.end();
}
