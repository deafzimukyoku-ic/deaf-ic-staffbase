import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderMergedPdf } from '@/lib/pdf/generate-pdf';
import { buildPlacementData } from '@/lib/pdf/resolve-pdf-values';
import type { PdfTag, PdfTagPlacement } from '@/lib/types';

/**
 * POST: Employee Mode PDF生成
 * body: { employee_id, template_id, form_data? }
 * 社員データ + テナント情報 + form_data からPDF差し込み生成
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { employee_id, template_id, form_data } = await request.json() as {
    employee_id: string;
    template_id: string;
    form_data?: Record<string, unknown>;
  };

  if (!employee_id || !template_id) {
    return NextResponse.json({ error: 'employee_id と template_id が必要です' }, { status: 400 });
  }

  // テンプレート取得
  const { data: template } = await supabase
    .from('document_templates')
    .select('*')
    .eq('id', template_id)
    .single();

  if (!template || !template.pdf_storage_path) {
    return NextResponse.json({ error: 'PDFテンプレートが見つかりません' }, { status: 404 });
  }

  // 社員データ取得
  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employee_id)
    .single();

  if (!employee) {
    return NextResponse.json({ error: '社員データが見つかりません' }, { status: 404 });
  }

  // テナントデータ取得
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', employee.tenant_id)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: 'テナントデータが見つかりません' }, { status: 404 });
  }

  // 銀行名取得（デフォルト）
  const { data: banks } = await supabase
    .from('tenant_payroll_banks')
    .select('bank_name')
    .eq('tenant_id', tenant.id)
    .eq('is_default', true)
    .limit(1);

  const bankName = banks?.[0]?.bank_name || '';

  // タグ・配置取得
  const [tagsRes, placementsRes] = await Promise.all([
    supabase.from('pdf_tags').select('*').eq('template_id', template_id),
    supabase.from('pdf_tag_placements').select('*').eq('template_id', template_id),
  ]);

  const tags = (tagsRes.data || []) as PdfTag[];
  const placements = (placementsRes.data || []) as PdfTagPlacement[];

  // form_data: リクエストから渡されるか、既存のsubmissionから取得
  let resolvedFormData = form_data || {};
  if (!form_data) {
    const { data: submission } = await supabase
      .from('document_submissions')
      .select('form_data')
      .eq('employee_id', employee_id)
      .eq('document_template_id', template_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (submission?.form_data) {
      resolvedFormData = submission.form_data as Record<string, unknown>;
    }
  }

  // テンプレートPDFダウンロード
  const { data: fileData } = await supabase.storage
    .from('documents')
    .download(template.pdf_storage_path);

  if (!fileData) {
    return NextResponse.json({ error: 'PDFファイルの取得に失敗しました' }, { status: 500 });
  }

  const templatePdfBytes = await fileData.arrayBuffer();

  // 値解決 + PDF生成
  try {
    const placementData = buildPlacementData(tags, placements, {
      employee: employee as Record<string, unknown>,
      tenant: tenant as Record<string, unknown>,
      formData: resolvedFormData,
      bankName,
    });

    const pdfBytes = await renderMergedPdf(templatePdfBytes, placementData);
    const fileName = `${employee.last_name}${employee.first_name}_${template.name}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'X-Filename': encodeURIComponent(fileName),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'PDF生成に失敗しました', detail: message }, { status: 500 });
  }
}
