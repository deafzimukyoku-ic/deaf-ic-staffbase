/* Vault の中身を診断: スキーマ有無 / テーブル / 全 secret 名 / vault.secrets 生テーブル */
import pg from 'pg';
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
const m = env.DATABASE_URL.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
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

await client.connect();
try {
  const s = await client.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name='vault'`);
  console.log('vault schema present:', s.rowCount > 0);
  const t = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='vault' ORDER BY table_name`);
  console.log('vault tables/views:', t.rows.map(r => r.table_name).join(', '));

  const allSec = await client.query(`SELECT name, length(decrypted_secret) AS len FROM vault.decrypted_secrets ORDER BY created_at DESC`)
    .catch((e) => ({ err: e.message, rows: [] }));
  if (allSec.err) console.log('decrypted_secrets read error:', allSec.err);
  else console.log('decrypted_secrets (all names):', allSec.rows.length === 0 ? 'EMPTY' : allSec.rows.map(r => r.name + '(len=' + r.len + ')').join(', '));

  const raw = await client.query(`SELECT id, name, description, created_at FROM vault.secrets ORDER BY created_at DESC LIMIT 50`)
    .catch((e) => ({ err: e.message, rows: [] }));
  if (raw.err) console.log('vault.secrets read error:', raw.err);
  else {
    console.log('vault.secrets rows:', raw.rowCount);
    for (const r of raw.rows) console.log('  ', r.name, '|', r.description || '(no desc)', '@', r.created_at.toISOString());
  }
} finally {
  await client.end();
}
