import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderMergedPdf, generateFileName } from '@/lib/pdf/generate-pdf';
import { createPdfZip } from '@/lib/pdf/bulk-pdf-zip';
import type { PdfTag, PdfTagPlacement, MatrixRow } from '@/lib/types';

/**
 * POST: マトリクスデータからPDF生成
 * mode: 'single' (1行 → PDF) | 'all' (全行 → ZIP)
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // 認証チェック
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await req.json();
  const { template_id, mode, row_index } = body as {
    template_id: string;
    mode: 'single' | 'all';
    row_index?: number;
  };

  if (!template_id) {
    return NextResponse.json({ error: 'template_id が必要です' }, { status: 400 });
  }

  // テンプレート取得
  const { data: template } = await supabase
    .from('document_templates')
    .select('*')
    .eq('id', template_id)
    .single();

  if (!template || !template.pdf_storage_path) {
    return NextResponse.json({ error: 'テンプレートが見つかりません' }, { status: 404 });
  }

  // テンプレートPDFダウンロード
  const { data: fileData } = await supabase.storage
    .from('documents')
    .download(template.pdf_storage_path);

  if (!fileData) {
    return NextResponse.json({ error: 'PDFファイルの取得に失敗しました' }, { status: 500 });
  }

  const templatePdfBytes = await fileData.arrayBuffer();

  // タグと配置を取得
  const [tagsRes, placementsRes, rowsRes] = await Promise.all([
    supabase.from('pdf_tags').select('*').eq('template_id', template_id).order('column_key'),
    supabase.from('pdf_tag_placements').select('*').eq('template_id', template_id),
    supabase.from('matrix_rows').select('*').eq('template_id', template_id).order('row_index'),
  ]);

  const tags = (tagsRes.data || []) as PdfTag[];
  const placements = (placementsRes.data || []) as PdfTagPlacement[];
  const matrixRows = (rowsRes.data || []) as MatrixRow[];

  if (matrixRows.length === 0) {
    return NextResponse.json({ error: 'マトリクスデータがありません' }, { status: 400 });
  }

  // タグID → column_key マッピング
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  // 1行分のPDFを生成する関数
  async function generateForRow(rowData: Record<string, string>) {
    const placementData = placements
      .map((p) => {
        const tag = tagMap.get(p.tag_id);
        if (!tag) return null;
        const value = rowData[tag.column_key] ?? '';
        return {
          page_number: p.page_number,
          x: Number(p.x),
          y: Number(p.y),
          font_size: p.font_size,
          value,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return renderMergedPdf(templatePdfBytes, placementData);
  }

  // display_name列のキーを探す（ファイル名用）
  const displayNameTag = tags.find((t) =>
    t.display_name.includes('名前') ||
    t.display_name.includes('氏名') ||
    t.display_name.includes('会社') ||
    t.display_name.includes('name')
  );
  const displayNameKey = displayNameTag?.column_key;

  if (mode === 'single') {
    // 単一行PDF
    const targetRow = row_index !== undefined
      ? matrixRows.find((r) => r.row_index === row_index)
      : matrixRows[0];

    if (!targetRow) {
      return NextResponse.json({ error: '指定された行が見つかりません' }, { status: 404 });
    }

    const pdfBytes = await generateForRow(targetRow.row_data);
    const fileName = generateFileName(targetRow.row_data, targetRow.row_index, displayNameKey);

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'X-Filename': fileName,
      },
    });
  }

  // 全行ZIP
  const files: { fileName: string; data: Uint8Array }[] = [];

  for (const row of matrixRows) {
    const pdfBytes = await generateForRow(row.row_data);
    const fileName = generateFileName(row.row_data, row.row_index, displayNameKey);
    files.push({ fileName, data: pdfBytes });
  }

  const zipBytes = await createPdfZip(files);

  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
  const zipName = `${template.name}_${dateStr}.zip`;

  return new NextResponse(Buffer.from(zipBytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}"`,
      'X-Filename': zipName,
    },
  });
}
