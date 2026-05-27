/* migration 212 (documents bucket file_size_limit 200MB) を本番 DB に適用 + 検証 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(projectRoot, '.env.local'), 'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) throw new Error('DATABASE_URL parse fail');

const sql = fs.readFileSync(
  path.resolve(projectRoot, 'supabase', 'migrations', '212_documents_bucket_size_limit_200mb.sql'),
  'utf8'
);

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${m[3]}`,
  password: decodeURIComponent(m[2]),
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  console.log('--- applying migration 212 ---');
  await client.query(sql);
  console.log('--- applied ---\n');

  console.log('=== verify: documents bucket file_size_limit ===');
  const b = await client.query(
    `SELECT id, file_size_limit FROM storage.buckets WHERE id='documents';`
  );
  if (b.rowCount === 0) throw new Error('documents bucket not found');
  const limit = Number(b.rows[0].file_size_limit);
  console.log(`documents.file_size_limit = ${limit} bytes (${(limit/1024/1024).toFixed(0)} MB)`);
  if (limit !== 200 * 1024 * 1024) {
    throw new Error(`expected 200 MB, got ${limit}`);
  }
  console.log('\nOK: documents バケット file_size_limit = 200 MB');
} finally {
  await client.end();
}
