import { NextRequest, NextResponse } from 'next/server';
import { parsePlaceholders } from '@/lib/docx/parse-placeholders';
import { MAX_DOCX_FILE_SIZE_MB } from '@/lib/constants';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return NextResponse.json({ error: 'ファイルが必要です' }, { status: 400 });
  }

  if (!file.name.endsWith('.docx')) {
    return NextResponse.json({ error: '.docxファイルのみ対応しています' }, { status: 400 });
  }

  const maxBytes = MAX_DOCX_FILE_SIZE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return NextResponse.json({ error: `ファイルサイズは${MAX_DOCX_FILE_SIZE_MB}MB以下にしてください` }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const placeholders = parsePlaceholders(buffer);
    return NextResponse.json({ placeholders });
  } catch (e) {
    return NextResponse.json({ error: 'docxの解析に失敗しました' }, { status: 500 });
  }
}
