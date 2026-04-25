import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { PLACEHOLDER_REGEX } from '@/lib/constants';

/**
 * docxバイナリからプレースホルダ {{key}} を全て抽出
 */
export function parsePlaceholders(docxBuffer: ArrayBuffer): string[] {
  const zip = new PizZip(docxBuffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
  });

  const text = doc.getFullText();
  const keys = new Set<string>();

  let match: RegExpExecArray | null;
  // RegExpのlastIndexをリセット
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    keys.add(match[1]);
  }

  return Array.from(keys);
}
