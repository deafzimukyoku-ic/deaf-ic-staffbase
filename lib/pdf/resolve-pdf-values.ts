/**
 * PDF Employee Mode: タグ値の解決
 * column_key ("employee.last_name") からソース種別を判定してデータを取得
 */

import type { PdfTag, PdfTagPlacement } from '@/lib/types';
import type { PlacementData } from './generate-pdf';
import { formatEmployeeFieldValue, stripEmojiForPdf } from '@/lib/employee-value-format';

export interface PdfFillContext {
  employee: Record<string, unknown>;
  tenant: Record<string, unknown>;
  formData: Record<string, unknown>;
  bankName?: string;
  /* employees.facility_id を facilities テーブルから引いた値。
     PDF タグ employee.facility_name / employee.facility_address で使う。 */
  facilityName?: string;
  facilityAddress?: string;
}

/**
 * 1つのタグの値を解決
 */
function resolvePdfTagValue(
  tag: PdfTag,
  ctx: PdfFillContext
): string {
  const columnKey = tag.column_key;
  const dotIndex = columnKey.indexOf('.');
  if (dotIndex === -1) return ''; // matrix-style key, employee modeでは使わない

  const sourceType = columnKey.substring(0, dotIndex);
  const sourceField = columnKey.substring(dotIndex + 1);

  switch (sourceType) {
    case 'employee': {
      /* facility_name / facility_address は employees に列が無い仮想フィールド。
         API 側で facilities から引いた値を ctx.facilityName / ctx.facilityAddress に詰めている。 */
      /* facility_name は先頭絵文字を除去（IPAex 明朝に絵文字グリフが無く tofu 化するため） */
      if (sourceField === 'facility_name') return stripEmojiForPdf(ctx.facilityName || '');
      if (sourceField === 'facility_address') return ctx.facilityAddress || '';

      // フィールド結合対応 ("last_name+first_name" → "佐藤杏南")
      if (sourceField.includes('+')) {
        return sourceField
          .split('+')
          .map((f) => formatEmployeeFieldValue(f.trim(), ctx.employee[f.trim()]))
          .join('');
      }
      return formatEmployeeFieldValue(sourceField, ctx.employee[sourceField]);
    }
    case 'tenant': {
      if (sourceField === 'bank_name') return ctx.bankName || '';
      return String(ctx.tenant[sourceField] ?? '');
    }
    case 'form_data': {
      return String(ctx.formData[sourceField] ?? '');
    }
    case 'fixed': {
      if (sourceField === 'today') {
        return new Date().toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
      return sourceField;
    }
    default:
      return '';
  }
}

/**
 * タグと配置からPDF描画用のPlacementData配列を構築
 */
export function buildPlacementData(
  tags: PdfTag[],
  placements: PdfTagPlacement[],
  ctx: PdfFillContext
): PlacementData[] {
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  return placements
    .map((p) => {
      const tag = tagMap.get(p.tag_id);
      if (!tag) return null;
      const value = resolvePdfTagValue(tag, ctx);
      return {
        page_number: p.page_number,
        x: Number(p.x),
        y: Number(p.y),
        font_size: p.font_size,
        value,
      };
    })
    .filter((p): p is PlacementData => p !== null);
}
