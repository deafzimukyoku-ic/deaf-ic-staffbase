/* Vault の中身を診断: スキーマ有無 / テーブル / 全 secret 名 / vault.secrets 生テーブル */
import { createPgClient, loadEnv } from './_db.mjs';

const env = loadEnv();
const client = createPgClient(env);

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
