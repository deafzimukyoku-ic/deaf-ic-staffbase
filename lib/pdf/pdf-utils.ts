/**
 * PDF ユーティリティ: フォント読み込みキャッシュ + 座標変換ヘルパー
 *
 * フォントは IPAex 明朝 固定（IPA Font License v1.0）。
 * MS 明朝 と字形がほぼ同等で、Vercel/Linux でも埋め込めるため採用。
 * 旧版は Noto Sans JP だったが、書類は明朝体が日本の公文書慣習に合うため変更。
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { PDF_ASCENT_RATIO } from '@/lib/constants';

/** プロセスレベルのフォントキャッシュ（一括生成のパフォーマンス対策） */
let ipaexMinchoBytes: Uint8Array | null = null;

/**
 * IPAex 明朝フォントバイナリを読み込む（キャッシュあり）
 * public/fonts/IPAexMincho-Regular.ttf を読み込む
 */
export async function loadIpaexMincho(): Promise<Uint8Array> {
  if (ipaexMinchoBytes) return ipaexMinchoBytes;

  const fontPath = join(process.cwd(), 'public', 'fonts', 'IPAexMincho-Regular.ttf');
  const buffer = await readFile(fontPath);
  ipaexMinchoBytes = new Uint8Array(buffer);
  return ipaexMinchoBytes;
}

/** 旧 API 互換のための alias（既存コードからの参照を破壊しない） */
export const loadNotoSansJp = loadIpaexMincho;

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
