/* 重複の正体調査。テンプレ名 / 発行タイムスタンプ / 発行者 / メッセージ / Storage path を全部出す。
   これで「同じ admin が bulk-issue を 2 回押した」「招待自動発行 + 手動発行が重なった」など原因を切り分ける */
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
  const tpl = await client.query(`
    SELECT id, name, is_company_issued, auto_issue_message, created_at
    FROM public.document_templates
    WHERE id IN (
      SELECT document_template_id
      FROM public.issued_documents
      WHERE revoked_at IS NULL
      GROUP BY employee_id, document_template_id
      HAVING COUNT(*) > 1
    );
  `);
  console.log('--- templates involved in duplicates ---');
  for (const r of tpl.rows) {
    console.log('  template:', r.id, r.name);
    console.log('    is_company_issued =', r.is_company_issued, ' auto_issue_message =', JSON.stringify(r.auto_issue_message), ' created_at =', r.created_at);
  }

  const dupDetail = await client.query(`
    WITH dups AS (
      SELECT employee_id, document_template_id
      FROM public.issued_documents
      WHERE revoked_at IS NULL
      GROUP BY employee_id, document_template_id
      HAVING COUNT(*) > 1
    )
    SELECT id.id, id.employee_id, id.document_template_id, id.issued_at, id.issued_by, id.issued_by_name,
           id.delivery_mode, id.message, id.generated_pdf_path, id.acknowledged_at, id.email_sent_at,
           e.last_name, e.first_name, e.status
    FROM public.issued_documents id
    JOIN dups d
      ON id.employee_id = d.employee_id
     AND id.document_template_id = d.document_template_id
    LEFT JOIN public.employees e ON e.id = id.employee_id
    WHERE id.revoked_at IS NULL
    ORDER BY id.employee_id, id.issued_at;
  `);
  console.log('\n--- per-duplicate records ---');
  let currentEmp = null;
  for (const r of dupDetail.rows) {
    if (r.employee_id !== currentEmp) {
      currentEmp = r.employee_id;
      console.log(`\n[employee] ${r.employee_id}  ${r.last_name ?? ''} ${r.first_name ?? ''}  status=${r.status}`);
    }
    console.log('  -', r.id, '|', r.issued_at.toISOString(),
      '| by:', r.issued_by_name, '(', r.issued_by, ')',
      '| mode:', r.delivery_mode,
      '| msg:', r.message ? r.message.slice(0, 30) + (r.message.length > 30 ? '...' : '') : '(none)',
      '| ack:', r.acknowledged_at ? 'YES' : 'no',
      '| pdf:', r.generated_pdf_path.split('/').pop());
  }

  /* 全 24 件のうち、上の重複に含まれない単独 active レコードがあるかも一応見ておく */
  const lone = await client.query(`
    SELECT id, employee_id, document_template_id, issued_at, issued_by_name
    FROM public.issued_documents
    WHERE revoked_at IS NULL
      AND (employee_id, document_template_id) NOT IN (
        SELECT employee_id, document_template_id
        FROM public.issued_documents
        WHERE revoked_at IS NULL
        GROUP BY employee_id, document_template_id
        HAVING COUNT(*) > 1
      )
    ORDER BY issued_at;
  `);
  console.log(`\n--- non-duplicate active rows (${lone.rowCount}) ---`);
  for (const r of lone.rows) {
    console.log('  ', r.id, '|', r.issued_at.toISOString(), '| tpl:', r.document_template_id.slice(0,8), '| by:', r.issued_by_name);
  }

  /* 取り消し済み (revoked_at IS NOT NULL) 件数も把握 */
  const revoked = await client.query(`SELECT COUNT(*) AS c FROM public.issued_documents WHERE revoked_at IS NOT NULL;`);
  console.log('\n--- revoked rows ---');
  console.log('  count =', revoked.rows[0].c);
} finally {
  await client.end();
}
