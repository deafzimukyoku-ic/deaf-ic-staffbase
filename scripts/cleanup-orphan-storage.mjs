/* migration 179 で revoke にした 8 件の Storage オブジェクトを service-role で削除。
   scripts/orphan-pdf-paths.json から読み取って 'issued-documents' バケットから消す。
   失敗しても DB 整合性は崩れない (パスは revoked 行に残るだけ) */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '..', '..', '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const url1 = env.NEXT_PUBLIC_SUPABASE_URL ?? `https://${env.DATABASE_URL.match(/db\.([^.]+)\./)[1]}.supabase.co`;
const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRole) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const supabase = createClient(url1, serviceRole, { auth: { persistSession: false } });

const orphans = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'orphan-pdf-paths.json'), 'utf8'));
const paths = orphans.map((o) => o.generated_pdf_path).filter(Boolean);
console.log(`Removing ${paths.length} orphan object(s) from bucket 'issued-documents'...`);

const { data, error } = await supabase.storage.from('issued-documents').remove(paths);
if (error) {
  console.error('remove error:', error);
  process.exit(2);
}
console.log('remove result:', data);
console.log('done.');
