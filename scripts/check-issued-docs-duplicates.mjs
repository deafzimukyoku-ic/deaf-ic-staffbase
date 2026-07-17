/* migration 179 適用前の重複検出。pooler 経由で実行。
   結果が 0 行なら INDEX 作成 OK。1 行以上ならユーザーに報告して手を止める。 */
import { createPgClient, loadEnv } from './_db.mjs';

const env = loadEnv();

const directUrl = env.DATABASE_URL;
if (!directUrl) {
  console.error('DATABASE_URL not found in .env.local at', envPath);
  process.exit(1);
}
/* 直接ホスト URL からパスワードと ref を取り出して pooler URL に差し替える */
const m = directUrl.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
if (!m) {
  console.error('DATABASE_URL is not a direct-host Supabase URL. Aborting.');
  process.exit(1);
}

const client = createPgClient(env);

await client.connect();
try {
  const dupRes = await client.query(`
    SELECT employee_id, document_template_id, COUNT(*) AS dup_count
    FROM public.issued_documents
    WHERE revoked_at IS NULL
    GROUP BY employee_id, document_template_id
    HAVING COUNT(*) > 1
    ORDER BY dup_count DESC
    LIMIT 20;
  `);
  const totalRes = await client.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE revoked_at IS NULL) AS active
    FROM public.issued_documents;
  `);
  const indexRes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='issued_documents' AND indexname='issued_documents_active_unique';
  `);
  console.log('--- issued_documents summary ---');
  console.log('total rows :', totalRes.rows[0].total);
  console.log('active rows:', totalRes.rows[0].active);
  console.log('existing index issued_documents_active_unique:', indexRes.rowCount > 0 ? 'YES (already applied)' : 'NO');
  console.log('--- duplicate (employee_id, document_template_id) with revoked_at IS NULL ---');
  if (dupRes.rowCount === 0) {
    console.log('OK: no duplicates. migration 179 can be applied safely.');
  } else {
    console.log(`FOUND ${dupRes.rowCount} duplicate group(s):`);
    for (const row of dupRes.rows) {
      console.log('  employee_id=', row.employee_id, 'template_id=', row.document_template_id, 'count=', row.dup_count);
    }
  }
} finally {
  await client.end();
}
