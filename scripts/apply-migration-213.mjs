/* migration 213 (videos バケット + RLS) を本番 DB に適用 + 検証 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(projectRoot, '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));

const sql = fs.readFileSync(
  path.resolve(projectRoot, 'supabase', 'migrations', '213_videos_storage_bucket.sql'),
  'utf8'
);

const client = createPgClient(env);

await client.connect();
try {
  console.log('--- applying migration 213 ---');
  await client.query(sql);
  console.log('--- applied ---\n');

  console.log('=== verify: videos bucket ===');
  const b = await client.query(
    `SELECT id, public, file_size_limit, allowed_mime_types
       FROM storage.buckets WHERE id='videos';`
  );
  if (b.rowCount === 0) throw new Error('videos bucket not found');
  const row = b.rows[0];
  const limit = Number(row.file_size_limit);
  console.log(`videos.public = ${row.public}`);
  console.log(`videos.file_size_limit = ${limit} bytes (${(limit/1024/1024).toFixed(0)} MB)`);
  console.log(`videos.allowed_mime_types = ${JSON.stringify(row.allowed_mime_types)}`);
  if (row.public !== false) throw new Error('expected public=false');
  if (limit !== 500 * 1024 * 1024) throw new Error(`expected 500 MB, got ${limit}`);
  const expectedMime = ['video/mp4','video/webm','video/quicktime'];
  const actualMime = Array.isArray(row.allowed_mime_types) ? [...row.allowed_mime_types].sort() : null;
  if (!actualMime || JSON.stringify(actualMime) !== JSON.stringify([...expectedMime].sort())) {
    throw new Error(`mime mismatch: expected ${expectedMime}, got ${actualMime}`);
  }

  console.log('\n=== verify: videos policies ===');
  const p = await client.query(
    `SELECT policyname, cmd, roles
       FROM pg_policies
      WHERE schemaname='storage' AND tablename='objects'
        AND policyname LIKE 'videos:%'
      ORDER BY policyname;`
  );
  console.log(`policies found: ${p.rowCount}`);
  for (const r of p.rows) {
    console.log(`  - ${r.policyname} (${r.cmd}, roles=${JSON.stringify(r.roles)})`);
  }
  const names = p.rows.map(r => r.policyname).sort();
  const expected = [
    'videos: admin or manager can manage',
    'videos: tenant members can read',
  ].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`policy mismatch: expected ${expected}, got ${names}`);
  }

  console.log('\nOK: videos バケット作成 + RLS 2 本 が反映されました');
} finally {
  await client.end();
}
