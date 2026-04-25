import JSZip from 'jszip';

interface DocxFile {
  filename: string;
  buffer: Buffer;
}

/**
 * 複数のdocxファイルをZIP化して返す
 */
export async function createBulkZip(files: DocxFile[]): Promise<Buffer> {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.filename, file.buffer);
  }

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return buf;
}
