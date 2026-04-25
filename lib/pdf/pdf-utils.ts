/**
 * PDF ユーティリティ: フォント読み込みキャッシュ + 座標変換ヘルパー
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { PDF_ASCENT_RATIO } from '@/lib/constants';

/** プロセスレベルのフォントキャッシュ（一括生成のパフォーマンス対策） */
let notoSansJpBytes: Uint8Array | null = null;

/**
 * Noto Sans JP フォントバイナリを読み込む（キャッシュあり）
 * public/fonts/NotoSansJP-Regular.ttf を読み込む
 */
export async function loadNotoSansJp(): Promise<Uint8Array> {
  if (notoSansJpBytes) return notoSansJpBytes;

  const fontPath = join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf');
  const buffer = await readFile(fontPath);
  notoSansJpBytes = new Uint8Array(buffer);
  return notoSansJpBytes;
}

/**
 * エディタ座標（左上原点, PDF points）→ pdf-lib 座標（左下原点, ベースライン）
 * Fabric.js の top = テキスト上端（bounding box top）
 * pdf-lib の y = ベースライン = ページ高さ - 上端Y - (fontSize × ascent比率)
 */
export function convertYToPdfLib(
  pageHeight: number,
  yFromTop: number,
  fontSize: number
): number {
  return pageHeight - yFromTop - fontSize * PDF_ASCENT_RATIO;
}
