/**
 * pdf-lib による差込 PDF 生成
 * テンプレート PDF にタグの値を配置して PDF バイナリを生成する
 * StaffBase 版: Noto Sans JP 固定、装飾なし（font_size のみ）
 * テキスト折り返し対応: タグのX位置から右端までの幅で自動改行
 */

import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { loadNotoSansJp, convertYToPdfLib } from './pdf-utils';

const RIGHT_MARGIN = 20; // 右端からの余白（PDF points）
const LINE_HEIGHT_RATIO = 1.5; // 行間倍率

export interface PlacementData {
  page_number: number;
  x: number;
  y: number;
  font_size: number;
  value: string;
}

/**
 * テキストを指定幅で折り返して行配列にする
 * 1文字ずつ幅を測定し、maxWidthを超えたら改行
 */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];

  const lines: string[] = [];
  let currentLine = '';

  for (const char of text) {
    const testLine = currentLine + char;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth > maxWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

/**
 * テンプレート PDF にデータを差し込んだ PDF バイナリを生成
 */
export async function renderMergedPdf(
  templatePdfBytes: ArrayBuffer,
  placements: PlacementData[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templatePdfBytes);
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await loadNotoSansJp();
  const notoSans = await pdfDoc.embedFont(fontBytes, { subset: false });

  const pages = pdfDoc.getPages();
  const black = rgb(0, 0, 0);

  for (const placement of placements) {
    if (!placement.value) continue;

    const pageIndex = placement.page_number - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // 折り返し幅: タグのX位置から右端余白までの距離
    const maxWidth = pageWidth - placement.x - RIGHT_MARGIN;

    const lines = wrapText(placement.value, notoSans, placement.font_size, maxWidth);
    const lineSpacing = placement.font_size * LINE_HEIGHT_RATIO;

    for (let i = 0; i < lines.length; i++) {
      const y = convertYToPdfLib(pageHeight, placement.y + i * lineSpacing, placement.font_size);

      page.drawText(lines[i], {
        x: placement.x,
        y,
        size: placement.font_size,
        font: notoSans,
        color: black,
      });
    }
  }

  return pdfDoc.save();
}

/**
 * 出力ファイル名を生成
 * {display_name列の値}_{YYYYMMDD}.pdf または output_{行番号}_{YYYYMMDD}.pdf
 */
export function generateFileName(
  rowData: Record<string, string>,
  rowIndex: number,
  displayNameColumnKey?: string
): string {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');

  if (displayNameColumnKey && rowData[displayNameColumnKey]) {
    const name = rowData[displayNameColumnKey]
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();
    return `${name}_${dateStr}.pdf`;
  }

  return `output_${rowIndex + 1}_${dateStr}.pdf`;
}
