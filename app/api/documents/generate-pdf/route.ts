import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderMergedPdf } from '@/lib/pdf/generate-pdf';
import { buildPlacementData } from '@/lib/pdf/resolve-pdf-values';
import type { PdfTag, PdfTagPlacement } from '@/lib/types';
import {
  DUMMY_EMPLOYEE,
  DUMMY_TENANT,
  DUMMY_BANK_NAME,
  DUMMY_FACILITY_NAME,
  DUMMY_FACILITY_ADDRESS,
} from '@/lib/preview-dummy-data';

/**
 * POST: Employee Mode PDF生成
 * body: { employee_id?, template_id, form_data?, preview? }
 * 社員データ + テナント情報 + form_data からPDF差し込み生成
 *
 * preview=true の場合: DB 参照せずダミーデータで生成（書類エディタのサンプルプレビュー用）
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { employee_id, template_id, form_data, preview } = await request.json() as {
    employee_id?: string;
    template_id: string;
    form_data?: Record<string, unknown>;
    preview?: boolean;
  };

  if (!template_id) {
    return NextResponse.json({ error: 'template_id が必要です' }, { status: 400 });
  }
  if (!preview && !employee_id) {
    return NextResponse.json({ error: 'employee_id が必要です' }, { status: 400 });
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

  /* プレビュー時はダミーデータ、それ以外はDB から実データ取得。
     ダミーは全カラム埋まっているので、どのタグでも値が見える状態でレイアウト確認できる。 */
  let employee: Record<string, unknown>;
  let tenant: Record<string, unknown>;
  let bankName: string;
  let facilityName = '';
  let facilityAddress = '';

  if (preview) {
    employee = DUMMY_EMPLOYEE;
    tenant = DUMMY_TENANT;
    bankName = DUMMY_BANK_NAME;
    facilityName = DUMMY_FACILITY_NAME;
    facilityAddress = DUMMY_FACILITY_ADDRESS;
  } else {
    const { data: empData } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employee_id!)
      .single();

    if (!empData) {
      return NextResponse.json({ error: '社員データが見つかりません' }, { status: 404 });
    }
    employee = empData as Record<string, unknown>;

    const { data: tenantData } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', empData.tenant_id)
      .single();

    if (!tenantData) {
      return NextResponse.json({ error: 'テナントデータが見つかりません' }, { status: 404 });
    }
    tenant = tenantData as Record<string, unknown>;

    // 銀行名取得（デフォルト）
    const { data: banks } = await supabase
      .from('tenant_payroll_banks')
      .select('bank_name')
      .eq('tenant_id', tenantData.id)
      .eq('is_default', true)
      .limit(1);

    bankName = banks?.[0]?.bank_name || '';

    // 所属事業所取得（facility_id があれば）
    if (empData.facility_id) {
      const { data: facility } = await supabase
        .from('facilities')
        .select('name, address')
        .eq('id', empData.facility_id)
        .single();
      facilityName = facility?.name || '';
      facilityAddress = facility?.address || '';
    }
  }

  // タグ・配置取得
  const [tagsRes, placementsRes] = await Promise.all([
    supabase.from('pdf_tags').select('*').eq('template_id', template_id),
    supabase.from('pdf_tag_placements').select('*').eq('template_id', template_id),
  ]);

  const tags = (tagsRes.data || []) as PdfTag[];
  const placements = (placementsRes.data || []) as PdfTagPlacement[];

  // form_data: リクエストから渡されるか、既存のsubmissionから取得
  // プレビュー時は submission 参照しない（employee_id が無いため）
  let resolvedFormData = form_data || {};
  if (!form_data && !preview && employee_id) {
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
      facilityName,
      facilityAddress,
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
