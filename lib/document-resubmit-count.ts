/* 179 (R1): 書類タブのバッジ件数と /my/documents 上の赤い「再提出する」ボタン数を一致させるための
   共通カウンタ。EmployeeLayout のサイドバーバッジと /my/documents/page.tsx の filter を
   同じロジックに揃える。

   従来の layout.tsx は audience フィルタも matrix 除外も is_company_issued 除外もせず、
   さらに submitted_at vs employees.updated_at の粗い timestamp 比較しか行っていなかったため、
   実際の赤ボタン数とずれていた。

   フィルタ順序:
   1) document_templates を tenant_id で取得
   2) data_mode='matrix' かつ template_type='pdf' は除外
   3) is_company_issued=true は除外 (会社→社員 発行用テンプは社員提出フロー対象外)
   4) audience ルール (template-audience) で employee に該当しないテンプを除外
   5) 残ったテンプそれぞれの最新提出について「needsResubmit」判定
      - employee_snapshot がある → needsResubmitBySnapshot で参照カラムだけ比較
      - snapshot 無い旧提出  → employees.updated_at > submitted_at の fallback
   6) true の合計を返す */

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractReferencedEmployeeFields, needsResubmitBySnapshot } from '@/lib/document-resubmit';
import { isEmployeeInAudience, loadTemplateAudience } from '@/lib/template-audience';
import type { DocumentSubmission, DocumentTemplate, Employee, PdfTag } from '@/lib/types';

export async function countDocumentsNeedingResubmit(
  supabase: SupabaseClient,
  employee: Employee,
): Promise<number> {
  if (!employee?.tenant_id || !employee.id) return 0;

  const { data: tplRows } = await supabase
    .from('document_templates')
    .select('*')
    .eq('tenant_id', employee.tenant_id);
  const templates = (tplRows ?? []) as DocumentTemplate[];
  if (templates.length === 0) return 0;

  const filteredByMode = templates.filter((t) => {
    if (t.template_type === 'pdf' && t.data_mode === 'matrix') return false;
    if (t.is_company_issued) return false;
    return true;
  });
  if (filteredByMode.length === 0) return 0;

  const audienceMap = await loadTemplateAudience(supabase, filteredByMode.map((t) => t.id));
  const targeted = filteredByMode.filter((t) => isEmployeeInAudience(t.id, employee, audienceMap));
  if (targeted.length === 0) return 0;

  const targetedIds = targeted.map((t) => t.id);
  const [subsRes, tagsRes] = await Promise.all([
    supabase
      .from('document_submissions')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('status', 'submitted')
      .in('document_template_id', targetedIds),
    supabase
      .from('pdf_tags')
      .select('*')
      .in('template_id', targetedIds),
  ]);

  const subs = (subsRes.data ?? []) as DocumentSubmission[];
  if (subs.length === 0) return 0;

  const tagsByTemplate = new Map<string, PdfTag[]>();
  for (const tag of (tagsRes.data ?? []) as PdfTag[]) {
    const arr = tagsByTemplate.get(tag.template_id) ?? [];
    arr.push(tag);
    tagsByTemplate.set(tag.template_id, arr);
  }

  const refFieldsByTemplate = new Map<string, Set<string>>();
  for (const t of targeted) {
    refFieldsByTemplate.set(t.id, extractReferencedEmployeeFields(t, tagsByTemplate.get(t.id) ?? []));
  }

  const empRow = employee as unknown as Record<string, unknown>;
  const empUpdatedAt = (empRow.updated_at as string | null) ?? null;

  let count = 0;
  for (const sub of subs) {
    if (!sub.submitted_at) continue;
    const refFields = refFieldsByTemplate.get(sub.document_template_id) ?? new Set<string>();
    if (sub.employee_snapshot) {
      if (needsResubmitBySnapshot(sub.employee_snapshot, empRow, refFields)) count += 1;
    } else if (empUpdatedAt && new Date(empUpdatedAt) > new Date(sub.submitted_at)) {
      /* snapshot 取得前の旧提出は従来の粗い timestamp fallback。false positive 寄りだが既存挙動を保つ */
      count += 1;
    }
  }
  return count;
}
