/**
 * PDF Employee Mode: タグ値の解決
 * column_key ("employee.last_name") からソース種別を判定してデータを取得
 */

import type { PdfTag, PdfTagPlacement } from '@/lib/types';
import type { PlacementData } from './generate-pdf';

// 日付カラム（YYYY-MM-DD → 年月日表示に変換する対象）
const DATE_FIELDS = new Set([
  'birth_date', 'join_date', 'license_expiry', 'insurance_expiry',
  'vehicle_inspection_expiry', 'retirement_date', 'guarantor_birth_date',
]);

/** "1992-05-01" → "1992年5月1日" */
function formatDateJP(value: string): string {
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

export interface PdfFillContext {
  employee: Record<string, unknown>;
  tenant: Record<string, unknown>;
  formData: Record<string, unknown>;
  bankName?: string;
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
      // フィールド結合対応 ("last_name+first_name" → "佐藤杏南")
      if (sourceField.includes('+')) {
        return sourceField
          .split('+')
          .map((f) => String(ctx.employee[f.trim()] ?? ''))
          .join('');
      }
      const val = String(ctx.employee[sourceField] ?? '');
      if (DATE_FIELDS.has(sourceField) && val) return formatDateJP(val);
      return val;
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
