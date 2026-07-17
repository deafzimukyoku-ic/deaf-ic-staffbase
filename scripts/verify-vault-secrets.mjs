/* Vault に cron_target_url / cron_secret が登録されているかを pooler 経由で確認。
   値そのものは出さず、長さと最初の数文字 (URL は全文、secret は先頭 4 文字) だけ表示する */
import { createPgClient, loadEnv } from './_db.mjs';
import url from 'node:url';

const env = loadEnv();
const client = createPgClient(env);

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
