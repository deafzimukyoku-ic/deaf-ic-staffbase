/* migration 179 を pooler 経由で適用。
   適用前後で重複件数 / INDEX 有無 / revoked 件数を表示して検証する */
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
const migrationSql = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'migrations', '179_issued_documents_unique_active.sql'), 'utf8');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${ref}`,
  password,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});

async function snapshot(label) {
  const dup = await client.query(`
    SELECT COUNT(*) AS dup_groups FROM (
      SELECT 1 FROM public.issued_documents
      WHERE revoked_at IS NULL
      GROUP BY employee_id, document_template_id
      HAVING COUNT(*) > 1
    ) s;
  `);
  const totals = await client.query(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE revoked_at IS NULL) AS active,
           COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
    FROM public.issued_documents;
  `);
  const idx = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='issued_documents'
      AND indexname='issued_documents_active_unique';
  `);
  console.log(`[${label}] total=${totals.rows[0].total}  active=${totals.rows[0].active}  revoked=${totals.rows[0].revoked}  dup_groups=${dup.rows[0].dup_groups}  index_present=${idx.rowCount > 0}`);
}

/* 適用「前」に新たに revoke される予定の id をキャプチャ (Storage 削除に使う) */
async function captureToRevoke() {
  const r = await client.query(`
    WITH ranked AS (
      SELECT id, employee_id, document_template_id, issued_at, generated_pdf_path,
             ROW_NUMBER() OVER (
               PARTITION BY employee_id, document_template_id
               ORDER BY issued_at DESC, id DESC
             ) AS rn
      FROM public.issued_documents
      WHERE revoked_at IS NULL
    )
    SELECT id, generated_pdf_path
    FROM ranked WHERE rn > 1;
  `);
  return r.rows;
}

await client.connect();
try {
  await snapshot('BEFORE');
  const toRevoke = await captureToRevoke();
  console.log(`\nWill revoke ${toRevoke.length} row(s). Storage paths to clean up after:`);
  for (const r of toRevoke) console.log('  ', r.id, '->', r.generated_pdf_path);

  fs.writeFileSync(path.resolve(__dirname, 'orphan-pdf-paths.json'), JSON.stringify(toRevoke, null, 2));
  console.log('\nWrote scripts/orphan-pdf-paths.json for Storage cleanup step.');

  console.log('\n--- applying migration 179 ---');
  await client.query(migrationSql);
  console.log('--- migration 179 applied ---\n');

  await snapshot('AFTER');
} finally {
  await client.end();
}
