import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { PlaceholderMapping } from '@/lib/types';
import type { Employee, Tenant } from '@/lib/types';
import { formatEmployeeFieldValue, stripEmojiForPdf } from '@/lib/employee-value-format';

interface FillContext {
  employee: Employee;
  tenant: Tenant;
  formData: Record<string, unknown>;
  bankName?: string;
  facilityName?: string;
  facilityAddress?: string;
}

/**
 * マッピング定義に従ってプレースホルダの値を解決
 */
function resolveValues(
  mapping: PlaceholderMapping[],
  ctx: FillContext,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const m of mapping) {
    let value = '';

    switch (m.source_type) {
      case 'employee': {
        const empRec = ctx.employee as unknown as Record<string, unknown>;
        /* facility_name / facility_address は仮想フィールド（ctx 経由） */
        if (m.source_field === 'facility_name') {
          /* 書類用は絵文字 prefix を除去（PDF 側と挙動を揃える） */
          value = stripEmojiForPdf(ctx.facilityName || '');
        } else if (m.source_field === 'facility_address') {
          value = ctx.facilityAddress || '';
        } else if (m.source_field.includes('+')) {
          // 結合フィールド（例: last_name+first_name）
          const parts = m.source_field.split('+');
          value = parts
            .map((f) => formatEmployeeFieldValue(f.trim(), empRec[f.trim()]))
            .join('');
        } else {
          value = formatEmployeeFieldValue(m.source_field, empRec[m.source_field]);
        }
        break;
      }
      case 'tenant': {
        if (m.source_field === 'bank_name') {
          value = ctx.bankName || '';
        } else {
          value = String((ctx.tenant as unknown as Record<string, unknown>)[m.source_field] ?? '');
        }
        break;
      }
      case 'form_data': {
        value = String(ctx.formData[m.source_field || m.key] ?? '');
        break;
      }
      case 'fixed': {
        if (m.source_field === 'today') {
          value = new Date().toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
        } else if (m.source_field === 'submission_date') {
          value = new Date().toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
        } else {
          value = m.source_field;
        }
        break;
      }
    }

    result[m.key] = value;
  }

  return result;
}

/**
 * docxテンプレにデータを差し込んでバイナリを返す
 */
export function fillTemplate(
  docxBuffer: ArrayBuffer,
  mapping: PlaceholderMapping[],
  ctx: FillContext,
): Buffer {
  const zip = new PizZip(docxBuffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
  });

  const data = resolveValues(mapping, ctx);
  doc.render(data);

  const buf = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return buf;
}
