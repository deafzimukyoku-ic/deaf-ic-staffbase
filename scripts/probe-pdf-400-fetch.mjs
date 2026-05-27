/* 400 を返している signed URL と、サービスロールで作り直した新しい signed URL を
   両方 fetch して、HTTP の応答内容で 400 の真因を見極める。読み取り専用。 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8')
    .split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_PATH = 'manuals/a899a744-deeb-41b6-9cad-68d27bb6fbac/1779848407962_yqppqj_migrated_1779848407962_yqppqj.pdf';
const ORIGINAL_TOKEN_URL = 'https://kzdhycvcdownaggiitay.supabase.co/storage/v1/object/sign/documents/manuals/a899a744-deeb-41b6-9cad-68d27bb6fbac/1779848407962_yqppqj_migrated_1779848407962_yqppqj.pdf?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV84OWQ4MWE3Ni1hYTU3LTQyZDItYjJlYy1hODgyNjIyM2I3MjgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJkb2N1bWVudHMvbWFudWFscy9hODk5YTc0NC1kZWViLTQxYjYtOWNhZC02OGQyN2JiNmZiYWMvMTc3OTg0ODQwNzk2Ml95cXBwcWpfbWlncmF0ZWRfMTc3OTg0ODQwNzk2Ml95cXBwcWoucGRmIiwiaWF0IjoxNzc5ODg4Njg4LCJleHAiOjE3Nzk4ODkyODh9.jBOG2srWvJDK3JXbr4-t2cMvhLsmgjCT1Y9ljUeDd4k';

console.log(`=== now (local) = ${new Date().toISOString()} ===`);
const tokenPayload = JSON.parse(Buffer.from(ORIGINAL_TOKEN_URL.split('token=')[1].split('.')[1], 'base64url').toString());
console.log(`token iat = ${new Date(tokenPayload.iat * 1000).toISOString()}`);
console.log(`token exp = ${new Date(tokenPayload.exp * 1000).toISOString()}`);
const tokenTtl = tokenPayload.exp * 1000 - Date.now();
console.log(`token は ${tokenTtl > 0 ? 'まだ有効 (残 ' + Math.floor(tokenTtl / 1000) + ' s)' : '失効済 (-' + Math.floor(-tokenTtl / 1000) + ' s)'}\n`);

console.log('--- (1) 元の URL を素のまま GET ---');
const r1 = await fetch(ORIGINAL_TOKEN_URL, { method: 'GET' });
console.log(`status: ${r1.status} ${r1.statusText}`);
console.log(`content-type: ${r1.headers.get('content-type')}`);
const body1 = await r1.text();
console.log(`body (first 400 chars):\n${body1.slice(0, 400)}\n`);

console.log('--- (2) 同じ path から新しい signed URL を service role で発行 ---');
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const { data: signed, error: signErr } = await admin.storage.from('documents').createSignedUrl(STORAGE_PATH, 600);
if (signErr) {
  console.error('sign error:', signErr);
  process.exit(1);
}
console.log(`new url: ${signed.signedUrl.slice(0, 120)}...`);

console.log('\n--- (3) 新しい URL を GET ---');
const r2 = await fetch(signed.signedUrl, { method: 'GET' });
console.log(`status: ${r2.status} ${r2.statusText}`);
console.log(`content-type: ${r2.headers.get('content-type')}`);
console.log(`content-length: ${r2.headers.get('content-length')}`);
const body2 = r2.ok ? '(binary, omitted)' : await r2.text();
console.log(`body (first 400 chars):\n${body2.slice(0, 400)}`);
