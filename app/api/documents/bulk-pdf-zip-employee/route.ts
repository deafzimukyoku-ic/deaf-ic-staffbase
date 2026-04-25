import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderMergedPdf } from '@/lib/pdf/generate-pdf';
import { buildPlacementData } from '@/lib/pdf/resolve-pdf-values';
import { createPdfZip } from '@/lib/pdf/bulk-pdf-zip';
import type { PdfTag, PdfTagPlacement, Employee } from '@/lib/types';

/**
 * POST: Employee Mode 一括PDF生成 → ZIP
 * body: { template_id }
 * テナント内の全社員（visibility_condition適用）分のPDFをZIPで返す
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { template_id } = await request.json() as { template_id: string };

  if (!template_id) {
    return NextResponse.json({ error: 'template_id が必要です' }, { status: 400 });
  }

  // テンプレート取得
  const { data: template } = await supabase
    .from('document_templates')
    .select('*')
    .eq('id', template_id)
    .single();

  if (!template || template.template_type !== 'pdf' || !template.pdf_storage_path) {
    return NextResponse.json({ error: 'PDFテンプレートが見つかりません' }, { status: 404 });
  }

  // テナント情報
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', template.tenant_id)
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

  // 社員一覧 → migration 119 自動判定で対象社員を絞り込み
  const { data: rawEmployees } = await supabase
    .from('employees')
    .select('*')
    .eq('tenant_id', template.tenant_id)
    .eq('status', 'active')
    .neq('role', 'admin')
    .order('employee_number');

  if (!rawEmployees || rawEmployees.length === 0) {
    return NextResponse.json({ error: '対象社員がいません' }, { status: 400 });
  }

  const { isDocumentApplicable, loadCustomFieldGates } = await import('@/lib/document-applicability');
  const customGates = await loadCustomFieldGates(supabase, template.tenant_id);
  const employees = rawEmployees.filter((e) =>
    isDocumentApplicable(template as unknown as import('@/lib/types').DocumentTemplate, e as unknown as import('@/lib/types').Employee, customGates),
  );

  if (employees.length === 0) {
    return NextResponse.json({ error: '該当する社員がいません（必須タグの該当者なし）' }, { status: 400 });
  }

  // タグ・配置取得
  const [tagsRes, placementsRes] = await Promise.all([
    supabase.from('pdf_tags').select('*').eq('template_id', template_id),
    supabase.from('pdf_tag_placements').select('*').eq('template_id', template_id),
  ]);

  const tags = (tagsRes.data || []) as PdfTag[];
  const placements = (placementsRes.data || []) as PdfTagPlacement[];

  // テンプレートPDFダウンロード
  const { data: fileData } = await supabase.storage
    .from('documents')
    .download(template.pdf_storage_path);

  if (!fileData) {
    return NextResponse.json({ error: 'PDFファイルの取得に失敗しました' }, { status: 500 });
  }

  const templatePdfBytes = await fileData.arrayBuffer();

  // 全社員分のform_dataを一括取得
  const { data: submissions } = await supabase
    .from('document_submissions')
    .select('employee_id, form_data')
    .eq('document_template_id', template_id);

  const formDataMap = new Map(
    (submissions || []).map((s) => [s.employee_id, (s.form_data || {}) as Record<string, unknown>])
  );

  // PDF一括生成
  const files: { fileName: string; data: Uint8Array }[] = [];

  for (const emp of employees as Employee[]) {
    const formData = formDataMap.get(emp.id) || {};

    const placementData = buildPlacementData(tags, placements, {
      employee: emp as unknown as Record<string, unknown>,
      tenant: tenant as Record<string, unknown>,
      formData,
      bankName,
    });

    const pdfBytes = await renderMergedPdf(templatePdfBytes, placementData);
    const fileName = `${emp.last_name}${emp.first_name}_${template.name}.pdf`;
    files.push({ fileName, data: pdfBytes });
  }

  // ZIP生成
  const zipBytes = await createPdfZip(files);
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
  const zipName = `${template.name}_全社員_${dateStr}.zip`;

  return new NextResponse(Buffer.from(zipBytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}"`,
      'X-Filename': zipName,
    },
  });
}
