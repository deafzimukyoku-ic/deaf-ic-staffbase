import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderMergedPdf } from '@/lib/pdf/generate-pdf';
import { buildPlacementData } from '@/lib/pdf/resolve-pdf-values';
import { createPdfZip } from '@/lib/pdf/bulk-pdf-zip';
import type { PdfTag, PdfTagPlacement, DocumentTemplate } from '@/lib/types';

/**
 * POST: 1社員の提出済みPDF書類を一括ZIP
 * body: { employee_id }
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { employee_id } = await request.json();

  if (!employee_id) {
    return NextResponse.json({ error: 'employee_id が必要です' }, { status: 400 });
  }

  // 社員データ
  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employee_id)
    .single();

  if (!employee) {
    return NextResponse.json({ error: '社員が見つかりません' }, { status: 404 });
  }

  // テナントデータ
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', employee.tenant_id)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: 'テナントが見つかりません' }, { status: 404 });
  }

  // 銀行名
  const { data: banks } = await supabase
    .from('tenant_payroll_banks')
    .select('bank_name')
    .eq('tenant_id', tenant.id)
    .eq('is_default', true)
    .limit(1);

  const bankName = banks?.[0]?.bank_name || '';

  // 所属事業所（このルートは単一社員固定なので1回だけ引く）
  let facilityName = '';
  let facilityAddress = '';
  if (employee.facility_id) {
    const { data: facility } = await supabase
      .from('facilities')
      .select('name, address')
      .eq('id', employee.facility_id)
      .single();
    facilityName = facility?.name || '';
    facilityAddress = facility?.address || '';
  }

  // 提出済みの書類を全取得
  const { data: submissions } = await supabase
    .from('document_submissions')
    .select('*, document_templates(*)')
    .eq('employee_id', employee_id)
    .in('status', ['submitted', 'approved']);

  if (!submissions || submissions.length === 0) {
    return NextResponse.json({ error: '提出済みの書類がありません' }, { status: 404 });
  }

  const files: { fileName: string; data: Uint8Array }[] = [];

  for (const sub of submissions) {
    const template = sub.document_templates as DocumentTemplate;

    // PDFテンプレートのみ処理
    if (template.template_type !== 'pdf' || !template.pdf_storage_path) continue;

    // タグ・配置取得
    const [tagsRes, placementsRes] = await Promise.all([
      supabase.from('pdf_tags').select('*').eq('template_id', template.id),
      supabase.from('pdf_tag_placements').select('*').eq('template_id', template.id),
    ]);

    const tags = (tagsRes.data || []) as PdfTag[];
    const placements = (placementsRes.data || []) as PdfTagPlacement[];

    // テンプレートPDFダウンロード
    const { data: fileData } = await supabase.storage
      .from('documents')
      .download(template.pdf_storage_path);

    if (!fileData) continue;

    const templatePdfBytes = await fileData.arrayBuffer();

    try {
      const placementData = buildPlacementData(tags, placements, {
        employee: employee as Record<string, unknown>,
        tenant: tenant as Record<string, unknown>,
        formData: (sub.form_data || {}) as Record<string, unknown>,
        bankName,
        facilityName,
        facilityAddress,
      });

      const pdfBytes = await renderMergedPdf(templatePdfBytes, placementData);
      files.push({ fileName: `${template.name}.pdf`, data: pdfBytes });
    } catch {
      // 個別エラーはスキップ
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'PDF生成に失敗しました' }, { status: 500 });
  }

  const zipBytes = await createPdfZip(files);
  const empName = `${employee.last_name}${employee.first_name}`;

  return new NextResponse(Buffer.from(zipBytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(empName)}_documents.zip"`,
    },
  });
}
