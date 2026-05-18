/* 175: タグ再提出判定ヘルパー
   テンプが参照する employee カラム集合を抽出 → snapshot vs 現在値を比較して
   「使ってないカラムの変更で再提出フラグが立つ」問題を回避する。

   参照箇所:
   - DOCX テンプ: template.mapping[] の source_type='employee' の source_field
   - PDF テンプ: pdf_tags[].column_key (= "employee.<field>" / "employee.<a>+<b>") */

import type { DocumentTemplate, PdfTag, PlaceholderMapping } from '@/lib/types';

/* 「employee.facility_name」「employee.facility_address」は employees に存在せず
   facilities テーブル経由の仮想フィールド。snapshot 比較対象から外す
   (どうしても変更検知したい場合は別途 facility テーブルのスナップショットが必要)。 */
const VIRTUAL_EMPLOYEE_FIELDS = new Set(['facility_name', 'facility_address']);

/** mapping + pdf_tags からテンプが参照する employees カラム名を集合化 */
export function extractReferencedEmployeeFields(
  template: Pick<DocumentTemplate, 'mapping'>,
  pdfTags: PdfTag[],
): Set<string> {
  const fields = new Set<string>();

  /* DOCX 系 mapping: source_type='employee' の source_field */
  for (const m of (template.mapping ?? []) as PlaceholderMapping[]) {
    if (m.source_type === 'employee' && m.source_field) {
      for (const f of m.source_field.split('+').map((s) => s.trim())) {
        if (f && !VIRTUAL_EMPLOYEE_FIELDS.has(f)) fields.add(f);
      }
    }
  }

  /* PDF 系 pdf_tags: column_key が "employee.<field>" 形式のみ拾う */
  for (const t of pdfTags) {
    const ck = t.column_key ?? '';
    const dot = ck.indexOf('.');
    if (dot === -1) continue;
    if (ck.substring(0, dot) !== 'employee') continue;
    const sf = ck.substring(dot + 1);
    /* "last_name+first_name" のような結合フィールドは + で分割 */
    for (const f of sf.split('+').map((s) => s.trim())) {
      if (f && !VIRTUAL_EMPLOYEE_FIELDS.has(f)) fields.add(f);
    }
  }

  return fields;
}

/** snapshot と現在 employees の値を、関連カラム集合だけで比較。違いがあれば true */
export function needsResubmitBySnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  employee: Record<string, unknown>,
  referencedFields: Set<string>,
): boolean {
  if (!snapshot) return false; /* snapshot 無い場合は呼び出し側で従来 fallback */
  if (referencedFields.size === 0) return false; /* 参照カラム無し = 再提出不要 */
  for (const f of referencedFields) {
    const before = snapshot[f] ?? null;
    const after = employee[f] ?? null;
    /* シンプル比較 (string / number / null)。jsonb の object/array は使われない想定 */
    if (String(before ?? '') !== String(after ?? '')) return true;
  }
  return false;
}
