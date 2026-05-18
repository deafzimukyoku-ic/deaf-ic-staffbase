/* 173 / 174: 書類発行 (会社→社員) の共通ロジック。
   /api/issued-documents/create (個別発行) / /api/employees/invite (招待自動発行) /
   /api/issued-documents/bulk-issue (一括発行) から呼ばれる。
   service-role の SupabaseClient を引数で受け取り、RLS bypass で
   1 件分の発行 (PDF 生成 + Storage 保存 + DB insert + 通知 or メール) を実行する。 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { renderMergedPdf } from '@/lib/pdf/generate-pdf';
import { buildPlacementData } from '@/lib/pdf/resolve-pdf-values';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { buildIssuedDocumentEmail } from '@/lib/email/issued-document-email';
import type { PdfTag, PdfTagPlacement } from '@/lib/types';

export interface IssueDocumentInput {
  tenantId: string;
  employeeId: string;
  templateId: string;
  issuerEmployeeId: string | null; /* null = システム発行 (現状なし、将来用) */
  issuerName: string;
  message: string | null;
  formData?: Record<string, unknown>;
}

export interface IssueDocumentResult {
  success: boolean;
  issuedDocumentId?: string;
  deliveryMode?: 'in_app' | 'email_only';
  emailSent?: boolean;
  emailError?: string | null;
  error?: string;
  detail?: string;
}

export async function issueDocument(
  admin: SupabaseClient,
  input: IssueDocumentInput
): Promise<IssueDocumentResult> {
  const { tenantId, employeeId, templateId, issuerEmployeeId, issuerName, message } = input;
  const formData = input.formData ?? {};

  /* 対象社員 */
  const { data: target } = await admin
    .from('employees')
    .select('id, tenant_id, facility_id, status, email, last_name, first_name')
    .eq('id', employeeId)
    .single();
  if (!target) return { success: false, error: '対象社員が見つかりません' };
  if (target.tenant_id !== tenantId) return { success: false, error: 'テナントが一致しません' };

  /* テンプレ */
  const { data: template } = await admin
    .from('document_templates')
    .select('*')
    .eq('id', templateId)
    .eq('tenant_id', tenantId)
    .single();
  if (!template || !template.pdf_storage_path) {
    return { success: false, error: 'PDFテンプレートが見つかりません' };
  }

  const [tagsRes, placementsRes] = await Promise.all([
    admin.from('pdf_tags').select('*').eq('template_id', templateId),
    admin.from('pdf_tag_placements').select('*').eq('template_id', templateId),
  ]);
  const tags = (tagsRes.data ?? []) as PdfTag[];
  const placements = (placementsRes.data ?? []) as PdfTagPlacement[];
  if (placements.length === 0) {
    return { success: false, error: 'このテンプレートはタグ配置が未設定です' };
  }

  /* 周辺データ */
  const { data: tenantRow } = await admin.from('tenants').select('*').eq('id', tenantId).single();
  const { data: empFull } = await admin.from('employees').select('*').eq('id', employeeId).single();
  const { data: bank } = await admin
    .from('tenant_payroll_banks')
    .select('bank_name')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .limit(1);
  let facilityName = '';
  let facilityAddress = '';
  if (target.facility_id) {
    const { data: f } = await admin
      .from('facilities')
      .select('name, address')
      .eq('id', target.facility_id)
      .single();
    facilityName = (f?.name as string) ?? '';
    facilityAddress = (f?.address as string) ?? '';
  }

  /* テンプレ PDF 取得 */
  const { data: fileData } = await admin.storage.from('documents').download(template.pdf_storage_path);
  if (!fileData) return { success: false, error: 'PDFテンプレートの取得に失敗しました' };
  const templatePdfBytes = await fileData.arrayBuffer();

  /* 差込 + 生成 */
  let pdfBytes: Uint8Array;
  try {
    const placementData = buildPlacementData(tags, placements, {
      employee: (empFull ?? {}) as Record<string, unknown>,
      tenant: (tenantRow ?? {}) as Record<string, unknown>,
      formData,
      bankName: (bank?.[0]?.bank_name as string) ?? '',
      facilityName,
      facilityAddress,
    });
    pdfBytes = await renderMergedPdf(templatePdfBytes, placementData);
  } catch (e) {
    return { success: false, error: 'PDF 生成に失敗しました', detail: e instanceof Error ? e.message : String(e) };
  }

  const issuedAt = new Date();
  const deliveryMode: 'in_app' | 'email_only' = target.status === 'retired' ? 'email_only' : 'in_app';

  if (deliveryMode === 'email_only' && !target.email) {
    return { success: false, error: '退職社員にメール送信できません (メールアドレス未登録)' };
  }

  /* Storage 保存 */
  const objectName = `${tenantId}/${employeeId}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await admin.storage
    .from('issued-documents')
    .upload(objectName, Buffer.from(pdfBytes), {
      contentType: 'application/pdf',
      upsert: false,
    });
  if (upErr) return { success: false, error: 'PDF 保存に失敗しました', detail: upErr.message };

  /* メール送信 (email_only のみ) */
  let emailSentAt: string | null = null;
  let emailError: string | null = null;
  if (deliveryMode === 'email_only') {
    const employeeName = `${target.last_name ?? ''} ${target.first_name ?? ''}`.trim();
    const companyName = (tenantRow?.company_name as string) || '名古屋ろう国際センター';
    const { subject, html, text } = buildIssuedDocumentEmail({
      employeeName,
      companyName,
      documentName: template.name,
      issuedByName: issuerName,
      issuedAt,
      message,
    });
    const fileName = `${employeeName}_${template.name}.pdf`.replace(/[\\/:*?"<>|]/g, '_');
    try {
      const res = await resend.emails.send({
        from: FROM_EMAIL,
        to: [target.email as string],
        subject,
        html,
        text,
        attachments: [{ filename: fileName, content: Buffer.from(pdfBytes).toString('base64') }],
      });
      if (res.error) {
        emailError = res.error.message || String(res.error);
      } else {
        emailSentAt = issuedAt.toISOString();
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
    }
  }

  /* DB INSERT */
  const { data: inserted, error: insErr } = await admin
    .from('issued_documents')
    .insert({
      tenant_id: tenantId,
      facility_id: target.facility_id,
      employee_id: employeeId,
      document_template_id: templateId,
      issued_by: issuerEmployeeId,
      issued_by_name: issuerName,
      issued_at: issuedAt.toISOString(),
      generated_pdf_path: objectName,
      message,
      delivery_mode: deliveryMode,
      email_sent_at: emailSentAt,
      email_to_address: deliveryMode === 'email_only' ? (target.email as string) : null,
      email_error: emailError,
    })
    .select('id')
    .single();
  if (insErr) {
    await admin.storage.from('issued-documents').remove([objectName]);
    return { success: false, error: '保存に失敗しました', detail: insErr.message };
  }

  /* in_app のみ通知ベルに INSERT */
  if (deliveryMode === 'in_app') {
    await admin.from('notifications').insert({
      tenant_id: tenantId,
      recipient_employee_id: employeeId,
      actor_employee_id: issuerEmployeeId,
      actor_name: issuerName,
      actor_facility_name: facilityName || null,
      event_type: 'document_issued',
      event_target_id: inserted.id,
      event_target_title: template.name,
    });
  }

  return {
    success: true,
    issuedDocumentId: inserted.id as string,
    deliveryMode,
    emailSent: emailSentAt !== null,
    emailError,
  };
}
