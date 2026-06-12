/* 実効アップロード上限の確定テスト:
   videos バケット (bucket file_size_limit=500MB) に 60MB のダミーを service_role でアップロード。
   - 成功     → グローバル上限は 60MB 以上。バケット設定どおり機能している
   - 失敗(size)→ プロジェクト全体の Storage グローバル上限が 50MB のまま (バケット設定が無効化されている)
   テスト後は必ず削除する。 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean)
    .filter(l => !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TENANT = 'a899a744-deeb-41b6-9cad-68d27bb6fbac';
const testPath = `videos/${TENANT}/__probe_size_test__.mp4`;

async function tryUpload(sizeMB) {
  const buf = Buffer.alloc(sizeMB * 1024 * 1024, 0);
  const { error } = await supabase.storage.from('videos')
    .upload(testPath, buf, { contentType: 'video/mp4', upsert: true });
  if (error) return { ok: false, msg: error.message };
  await supabase.storage.from('videos').remove([testPath]); // 後始末
  return { ok: true };
}

for (const sizeMB of [60, 120]) {
  const r = await tryUpload(sizeMB);
  console.log(`videos に ${sizeMB}MB アップロード: ${r.ok ? 'OK ✅ (削除済)' : 'FAIL ❌ → ' + r.msg}`);
  if (!r.ok) break; // 失敗したら大きい方は試さない
}
