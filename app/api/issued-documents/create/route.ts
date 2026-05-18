/* 173 / 174: 書類発行 (会社→社員) — 個別発行 API
   POST { employee_id, template_id, message?, form_data? }
   - ロール認可: admin / manager (manager は管轄チェック)
   - 共通発行ロジックは lib/issued-documents/issue-helper.ts に集約 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { issueDocument } from '@/lib/issued-documents/issue-helper';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: me } = await supabase
    .from('employees')
    .select('id, tenant_id, role, facility_id, last_name, first_name')
    .eq('auth_user_id', user.id)
    .single();
  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (me.role !== 'admin' && me.role !== 'manager') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const body = (await req.json()) as {
    employee_id?: string;
    template_id?: string;
    message?: string;
    form_data?: Record<string, unknown>;
  };
  const employeeId = body.employee_id;
  const templateId = body.template_id;
  const message = (body.message ?? '').trim() || null;
  const formData = body.form_data ?? {};

  if (!employeeId || !templateId) {
    return NextResponse.json({ error: 'employee_id と template_id が必要です' }, { status: 400 });
  }

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  /* manager は自管轄施設の社員のみ可。主所属 ∪ manager_facilities で判定 */
  if (me.role === 'manager') {
    const { data: target } = await admin
      .from('employees')
      .select('facility_id, tenant_id')
      .eq('id', employeeId)
      .single();
    if (!target || target.tenant_id !== me.tenant_id) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    if (!target.facility_id) {
      return NextResponse.json({ error: 'manager は施設未所属社員に発行できません' }, { status: 403 });
    }
    const ownFid = me.facility_id === target.facility_id;
    let allowed = ownFid;
    if (!allowed) {
      const { data: mf } = await admin
        .from('manager_facilities')
        .select('facility_id')
        .eq('employee_id', me.id)
        .eq('facility_id', target.facility_id);
      allowed = (mf ?? []).length > 0;
    }
    if (!allowed) {
      return NextResponse.json({ error: '管轄外の施設の社員には発行できません' }, { status: 403 });
    }
  }

  const issuerName = `${me.last_name ?? ''} ${me.first_name ?? ''}`.trim() || '管理者';
  const result = await issueDocument(admin, {
    tenantId: me.tenant_id,
    employeeId,
    templateId,
    issuerEmployeeId: me.id,
    issuerName,
    message,
    formData,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json({
    success: true,
    issued_document_id: result.issuedDocumentId,
    delivery_mode: result.deliveryMode,
    email_sent: result.emailSent,
    email_error: result.emailError,
  });
}
