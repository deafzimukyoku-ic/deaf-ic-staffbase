/**
 * 複数 PDF ファイルを ZIP に圧縮する
 */

import JSZip from 'jszip';

interface PdfFile {
  fileName: string;
  data: Uint8Array;
}

/**
 * 複数の PDF ファイルを ZIP に圧縮
 * @param files ファイル名とデータの配列
 * @returns ZIP バイナリ
 */
export async function createPdfZip(files: PdfFile[]): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.fileName, file.data);
  }

  return zip.generateAsync({ type: 'uint8array' });
}
