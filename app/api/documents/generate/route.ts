import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fillTemplate } from '@/lib/docx/fill-template';
import type { PlaceholderMapping, Employee, Tenant } from '@/lib/types';

export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { submission_id } = await request.json();

  if (!submission_id) {
    return NextResponse.json({ error: 'submission_id が必要です' }, { status: 400 });
  }

  // 提出データ取得
  const { data: submission, error: subErr } = await supabase
    .from('document_submissions')
    .select('*, document_templates(*)')
    .eq('id', submission_id)
    .single();

  if (subErr || !submission) {
    return NextResponse.json({ error: '提出データが見つかりません' }, { status: 404 });
  }

  const template = submission.document_templates;

  // 社員データ取得
  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('id', submission.employee_id)
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

  // 所属事業所取得（facility_id があれば）
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

  // テンプレファイルをStorageから取得
  const { data: fileData, error: fileErr } = await supabase.storage
    .from('documents')
    .download(template.docx_storage_path);

  if (fileErr || !fileData) {
    return NextResponse.json({ error: 'テンプレートファイルの取得に失敗しました' }, { status: 500 });
  }

  const docxBuffer = await fileData.arrayBuffer();

  // 差し込み実行
  try {
    const result = fillTemplate(
      docxBuffer,
      template.mapping as PlaceholderMapping[],
      {
        employee: employee as Employee,
        tenant: tenant as Tenant,
        formData: (submission.form_data || {}) as Record<string, unknown>,
        bankName,
        facilityName,
        facilityAddress,
      },
    );

    return new NextResponse(new Uint8Array(result), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(template.name)}.docx"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: 'docx生成に失敗しました' }, { status: 500 });
  }
}
