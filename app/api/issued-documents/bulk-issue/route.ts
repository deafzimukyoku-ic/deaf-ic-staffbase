/* 174: 会社発行用テンプレを在籍社員全員に一括発行
   GET  /api/issued-documents/bulk-issue   → ドライラン (発行予定件数 + 内訳を返す)
   POST /api/issued-documents/bulk-issue   → 実発行 (admin のみ)
   - 対象テンプレ: document_templates.is_company_issued = true かつ
                  pdf_storage_path 有 かつ pdf_tag_placements 1 件以上
   - 対象社員  : employees.status = 'active'
                 (shift_manager 除外 - 進捗管理対象外なので発行対象からも除外)
   - 重複防止  : 「revoked_at IS NULL の発行が既に存在する組合せ」は skip
                  (= 取り消し済も含めて『現在 active な発行が無い』 = 未発行とみなす) */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { issueDocument } from '@/lib/issued-documents/issue-helper';
import type { SupabaseClient } from '@supabase/supabase-js';

interface PlanItem {
  templateId: string;
  templateName: string;
  autoMessage: string | null;
  employeeIds: string[];
}

async function buildPlan(admin: SupabaseClient, tenantId: string): Promise<PlanItem[]> {
  /* 1) is_company_issued=true のテンプレ取得 */
  const { data: tpls } = await admin
    .from('document_templates')
    .select('id, name, pdf_storage_path, auto_issue_message')
    .eq('tenant_id', tenantId)
    .eq('is_company_issued', true);
  const templates = (tpls ?? []) as Array<{
    id: string;
    name: string;
    pdf_storage_path: string | null;
    auto_issue_message: string | null;
  }>;
  if (templates.length === 0) return [];

  /* タグ配置が 1 件以上あるテンプレに絞る */
  const tplIds = templates.map((t) => t.id);
  const { data: placements } = await admin
    .from('pdf_tag_placements')
    .select('template_id')
    .in('template_id', tplIds);
  const tplWithPlacements = new Set((placements ?? []).map((p) => p.template_id as string));
  const validTemplates = templates.filter((t) => t.pdf_storage_path && tplWithPlacements.has(t.id));
  if (validTemplates.length === 0) return [];

  /* 2) 在籍社員 (shift_manager 除外) */
  const { data: emps } = await admin
    .from('employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .neq('role', 'shift_manager');
  const employeeIds = (emps ?? []).map((e) => e.id as string);
  if (employeeIds.length === 0) return [];

  /* 3) 既存 active 発行 (revoked_at IS NULL) を取得して skip 対象を作る */
  const { data: existing } = await admin
    .from('issued_documents')
    .select('employee_id, document_template_id')
    .eq('tenant_id', tenantId)
    .is('revoked_at', null)
    .in('document_template_id', validTemplates.map((t) => t.id));
  const existingKey = new Set(
    (existing ?? []).map((r) => `${r.employee_id}::${r.document_template_id}`)
  );

  /* 4) 発行プラン構築 */
  return validTemplates.map((t) => ({
    templateId: t.id,
    templateName: t.name,
    autoMessage: t.auto_issue_message,
    employeeIds: employeeIds.filter((eid) => !existingKey.has(`${eid}::${t.id}`)),
  }));
}

/* GET = ドライラン */
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { data: me } = await supabase
    .from('employees')
    .select('tenant_id, role')
    .eq('auth_user_id', user.id)
    .single();
  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (me.role !== 'admin') return NextResponse.json({ error: '権限がありません' }, { status: 403 });

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const plan = await buildPlan(admin, me.tenant_id);
  const totalCount = plan.reduce((sum, p) => sum + p.employeeIds.length, 0);
  return NextResponse.json({
    success: true,
    total: totalCount,
    items: plan.map((p) => ({
      template_id: p.templateId,
      template_name: p.templateName,
      employee_count: p.employeeIds.length,
    })),
  });
}

/* POST = 実発行 */
export async function POST(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const { data: me } = await supabase
    .from('employees')
    .select('id, tenant_id, role, last_name, first_name')
    .eq('auth_user_id', user.id)
    .single();
  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (me.role !== 'admin') return NextResponse.json({ error: '権限がありません' }, { status: 403 });

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const plan = await buildPlan(admin, me.tenant_id);
  const issuerName = `${me.last_name ?? ''} ${me.first_name ?? ''}`.trim() || '管理者';

  let issued = 0;
  let failed = 0;
  const failures: Array<{ employee_id: string; template_id: string; error: string }> = [];

  /* 順次実行 (PDF 生成 + Storage upload で並列度高すぎると Storage rate limit に当たる) */
  for (const item of plan) {
    for (const eid of item.employeeIds) {
      const res = await issueDocument(admin, {
        tenantId: me.tenant_id,
        employeeId: eid,
        templateId: item.templateId,
        issuerEmployeeId: me.id,
        issuerName,
        message: item.autoMessage,
      });
      if (res.success) {
        issued++;
      } else {
        failed++;
        failures.push({ employee_id: eid, template_id: item.templateId, error: res.error ?? '不明' });
      }
    }
  }

  return NextResponse.json({
    success: true,
    issued,
    failed,
    failures: failures.slice(0, 20), /* 大量にならないよう先頭 20 件まで */
  });
}
