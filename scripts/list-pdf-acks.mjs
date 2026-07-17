/* PDF を含むコンテンツ (遵守事項/お知らせ/業務マニュアル/研修) の
   ack/read/submission 行を全件列挙する。

   背景: 旧 PDF ビューアが <iframe> 単純埋め込みで、iOS Safari / iOS Chrome /
   iOS WKWebView では 1 ページ目しか描画されない既知制約があった。
   どの DB テーブルにも user_agent カラムが無いため「モバイル経由の既読」を
   厳密に切り出すクエリは書けない。代わりに「PDF を含むアイテムへの既読を全件」
   洗い出してユーザーが再閲覧依頼を出す判断材料を提供する。

   出力:
     - docs/pdf-mobile-bug/pdf-acks-compliance.csv
     - docs/pdf-mobile-bug/pdf-acks-announcement.csv
     - docs/pdf-mobile-bug/pdf-acks-manual.csv
     - docs/pdf-mobile-bug/pdf-acks-training.csv  (リセット対象外、通知用)
   stdout に件数サマリを出す。
   読み取り専用クエリのみ。DB 変更はしない。 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const client = createPgClient(env);

const outDir = path.resolve(__dirname, '..', 'docs', 'pdf-mobile-bug');
fs.mkdirSync(outDir, { recursive: true });

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCsv(file, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(file, '');
    return;
  }
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

/* テーブルに pdf_storage_path カラムが存在するか動的判定して、PDF 添付判定式を作る。
   - content_blocks: jsonb 配列のいずれかに type=pdf があれば PDF 付き
   - pdf_storage_path: 旧形式の単独 PDF 添付 (manuals/trainings 用) */
async function hasPdfPredicate(table, alias = table) {
  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
       AND column_name IN ('pdf_storage_path','content_blocks')`, [table]);
  const set = new Set(cols.rows.map(r => r.column_name));
  const exprs = [];
  if (set.has('content_blocks')) {
    exprs.push(`jsonb_path_exists(${alias}.content_blocks, '$[*] ? (@.type == "pdf")')`);
  }
  if (set.has('pdf_storage_path')) {
    exprs.push(`(${alias}.pdf_storage_path IS NOT NULL AND ${alias}.pdf_storage_path <> '')`);
  }
  if (exprs.length === 0) throw new Error(`${table} に content_blocks も pdf_storage_path も無い`);
  return exprs.join(' OR ');
}

await client.connect();
try {
  const summary = {};

  /* 1) compliance: compliance_documents には title が無い (content text のみ)。
        ラベルは content の先頭で代用。 */
  {
    const pred = await hasPdfPredicate('compliance_documents', 'd');
    const sql = `
      SELECT
        ack.id                                          AS ack_id,
        d.id                                            AS item_id,
        d.tenant_id,
        LEFT(d.content, 60)                             AS item_label,
        ack.employee_id,
        e.last_name || ' ' || e.first_name              AS employee_name,
        e.employee_number,
        e.email,
        e.facility_id,
        f.name                                          AS facility_name,
        ack.acknowledged_at                             AS read_at
      FROM public.compliance_documents d
      JOIN public.compliance_acknowledgments ack ON ack.compliance_document_id = d.id
      JOIN public.employees e ON e.id = ack.employee_id
      LEFT JOIN public.facilities f ON f.id = e.facility_id
      WHERE ${pred}
      ORDER BY ack.acknowledged_at`;
    const r = await client.query(sql);
    writeCsv(path.join(outDir, 'pdf-acks-compliance.csv'), r.rows);
    summary.compliance = r.rowCount;
  }

  /* 2) announcements: title + body + content_blocks */
  {
    const pred = await hasPdfPredicate('announcements', 'a');
    const sql = `
      SELECT
        a.id                                            AS item_id,
        a.tenant_id,
        a.title                                         AS item_label,
        ar.employee_id,
        e.last_name || ' ' || e.first_name              AS employee_name,
        e.employee_number,
        e.email,
        e.facility_id,
        f.name                                          AS facility_name,
        ar.read_at
      FROM public.announcements a
      JOIN public.announcement_reads ar ON ar.announcement_id = a.id
      JOIN public.employees e ON e.id = ar.employee_id
      LEFT JOIN public.facilities f ON f.id = e.facility_id
      WHERE ${pred}
      ORDER BY ar.read_at`;
    const r = await client.query(sql);
    writeCsv(path.join(outDir, 'pdf-acks-announcement.csv'), r.rows);
    summary.announcement = r.rowCount;
  }

  /* 3) manuals: title + body + pdf_storage_path (旧形式) + content_blocks */
  {
    const pred = await hasPdfPredicate('manuals', 'm');
    const sql = `
      SELECT
        m.id                                            AS item_id,
        m.tenant_id,
        m.title                                         AS item_label,
        mr.employee_id,
        e.last_name || ' ' || e.first_name              AS employee_name,
        e.employee_number,
        e.email,
        e.facility_id,
        f.name                                          AS facility_name,
        mr.read_at
      FROM public.manuals m
      JOIN public.manual_reads mr ON mr.manual_id = m.id
      JOIN public.employees e ON e.id = mr.employee_id
      LEFT JOIN public.facilities f ON f.id = e.facility_id
      WHERE ${pred}
      ORDER BY mr.read_at`;
    const r = await client.query(sql);
    writeCsv(path.join(outDir, 'pdf-acks-manual.csv'), r.rows);
    summary.manual = r.rowCount;
  }

  /* 4) trainings: 通知用のみ。リセット対象外 (training_submissions は感想文を含む)。 */
  {
    const pred = await hasPdfPredicate('trainings', 't');
    const sql = `
      SELECT
        ts.id                                           AS submission_id,
        t.id                                            AS item_id,
        t.tenant_id,
        t.title                                         AS item_label,
        ts.employee_id,
        e.last_name || ' ' || e.first_name              AS employee_name,
        e.employee_number,
        e.email,
        e.facility_id,
        f.name                                          AS facility_name,
        ts.result,
        ts.submitted_at                                 AS read_at
      FROM public.trainings t
      JOIN public.training_submissions ts ON ts.training_id = t.id
      JOIN public.employees e ON e.id = ts.employee_id
      LEFT JOIN public.facilities f ON f.id = e.facility_id
      WHERE ${pred}
      ORDER BY ts.submitted_at`;
    const r = await client.query(sql);
    writeCsv(path.join(outDir, 'pdf-acks-training.csv'), r.rows);
    summary.training = r.rowCount;
  }

  /* 5) 影響を受ける社員のユニーク数 (4 カテゴリ合算) — お知らせ告知の対象人数把握用 */
  const uniqEmp = await client.query(`
    WITH affected AS (
      SELECT ack.employee_id
        FROM public.compliance_documents d
        JOIN public.compliance_acknowledgments ack ON ack.compliance_document_id = d.id
       WHERE jsonb_path_exists(d.content_blocks, '$[*] ? (@.type == "pdf")')
      UNION
      SELECT ar.employee_id
        FROM public.announcements a
        JOIN public.announcement_reads ar ON ar.announcement_id = a.id
       WHERE jsonb_path_exists(a.content_blocks, '$[*] ? (@.type == "pdf")')
      UNION
      SELECT mr.employee_id
        FROM public.manuals m
        JOIN public.manual_reads mr ON mr.manual_id = m.id
       WHERE jsonb_path_exists(m.content_blocks, '$[*] ? (@.type == "pdf")')
          OR (m.pdf_storage_path IS NOT NULL AND m.pdf_storage_path <> '')
      UNION
      SELECT ts.employee_id
        FROM public.trainings t
        JOIN public.training_submissions ts ON ts.training_id = t.id
       WHERE jsonb_path_exists(t.content_blocks, '$[*] ? (@.type == "pdf")')
          OR (t.pdf_storage_path IS NOT NULL AND t.pdf_storage_path <> '')
    )
    SELECT COUNT(*)::int AS n FROM affected`);

  console.log('=== PDF を含むアイテムへの既読 (deaf-ic 本番) ===');
  console.log(`遵守事項 (compliance_acknowledgments): ${summary.compliance} 件`);
  console.log(`お知らせ (announcement_reads)       : ${summary.announcement} 件`);
  console.log(`業務マニュアル (manual_reads)       : ${summary.manual} 件`);
  console.log(`研修 (training_submissions)         : ${summary.training} 件 ※リセット対象外`);
  console.log(`---`);
  console.log(`影響社員 (ユニーク employee_id)      : ${uniqEmp.rows[0].n} 人`);
  console.log(`---`);
  console.log(`CSV 出力先: docs/pdf-mobile-bug/`);

  /* 6) アイテム単位サマリ (どの書類・お知らせ・マニュアル・研修が PDF 持ち？) */
  const items = await client.query(`
    SELECT 'compliance' AS kind, d.id, LEFT(d.content,60) AS title,
           (SELECT COUNT(*) FROM public.compliance_acknowledgments ack WHERE ack.compliance_document_id = d.id)::int AS reads
      FROM public.compliance_documents d
     WHERE jsonb_path_exists(d.content_blocks, '$[*] ? (@.type == "pdf")')
    UNION ALL
    SELECT 'announcement', a.id, a.title,
           (SELECT COUNT(*) FROM public.announcement_reads ar WHERE ar.announcement_id = a.id)::int
      FROM public.announcements a
     WHERE jsonb_path_exists(a.content_blocks, '$[*] ? (@.type == "pdf")')
    UNION ALL
    SELECT 'manual', m.id, m.title,
           (SELECT COUNT(*) FROM public.manual_reads mr WHERE mr.manual_id = m.id)::int
      FROM public.manuals m
     WHERE jsonb_path_exists(m.content_blocks, '$[*] ? (@.type == "pdf")')
        OR (m.pdf_storage_path IS NOT NULL AND m.pdf_storage_path <> '')
    UNION ALL
    SELECT 'training', t.id, t.title,
           (SELECT COUNT(*) FROM public.training_submissions ts WHERE ts.training_id = t.id)::int
      FROM public.trainings t
     WHERE jsonb_path_exists(t.content_blocks, '$[*] ? (@.type == "pdf")')
        OR (t.pdf_storage_path IS NOT NULL AND t.pdf_storage_path <> '')
    ORDER BY 1, reads DESC`);
  writeCsv(path.join(outDir, 'pdf-items.csv'), items.rows);
  console.log(`\n=== PDF 添付アイテム ${items.rowCount} 件 ===`);
  for (const r of items.rows) {
    console.log(`  [${r.kind}] ${r.reads} 既読 — ${String(r.title || '').slice(0, 50)}`);
  }

} finally {
  await client.end();
}
