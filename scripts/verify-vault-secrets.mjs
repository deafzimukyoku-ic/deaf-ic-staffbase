/* Vault に cron_target_url / cron_secret が登録されているかを pooler 経由で確認。
   値そのものは出さず、長さと最初の数文字 (URL は全文、secret は先頭 4 文字) だけ表示する */
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
  const res = await client.query(`
    SELECT name, length(decrypted_secret) AS len,
           substr(decrypted_secret, 1, 4) AS head
    FROM vault.decrypted_secrets
    WHERE name IN ('cron_target_url', 'cron_secret')
    ORDER BY name;
  `);
  console.log('--- Vault secrets ---');
  if (res.rowCount === 0) {
    console.log('  none found (Vault に未登録)');
  } else {
    for (const r of res.rows) {
      const preview = r.name === 'cron_target_url'
        ? (await client.query(`SELECT decrypted_secret AS v FROM vault.decrypted_secrets WHERE name=$1`, [r.name])).rows[0].v
        : `${r.head}...`;
      console.log('  ', r.name, '| length=', r.len, '| value:', preview);
    }
  }
} finally {
  await client.end();
}
