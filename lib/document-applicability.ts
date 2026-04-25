/**
 * 書類が当該社員に必要か判定（Document Applicability）
 *
 * ロジック:
 *   - 書類のタグ (mapping) のうち required=true のものをすべて取得
 *   - 各 required タグの source_field が isFieldApplicable で「該当」と返るかチェック
 *   - 1 つでも該当タグがあれば書類は該当（提出必要）
 *   - すべて非該当 OR required タグが無い → 書類非該当（提出不要、進捗カウント外）
 *
 * 旧 visibility_condition は migration 119 で廃止。代わりにこの関数で判定。
 */

import type { DocumentTemplate, Employee } from '@/lib/types';
import { isFieldApplicable } from '@/lib/field-applicability';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * カスタム項目のゲート設定を一括ロードして field_key → gate_fields の Map を返す。
 * 同 tenant の全カスタム項目について 1 回だけクエリ。
 */
export async function loadCustomFieldGates(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Map<string, string[]>> {
  const { data } = await supabase
    .from('custom_employee_fields')
    .select('field_key, gate_fields')
    .eq('tenant_id', tenantId);
  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as { field_key: string; gate_fields: string[] | null }[]) {
    if (row.gate_fields && row.gate_fields.length > 0) {
      map.set(row.field_key, row.gate_fields);
    }
  }
  return map;
}

/**
 * 書類が当該社員に必要か判定。
 * customFieldGates: custom_employee_fields の gate_fields を field_key → gate_fields の Map にしたもの。
 *                   employee 側の load 時に作って渡す。
 */
export function isDocumentApplicable(
  template: Pick<DocumentTemplate, 'mapping'>,
  employee: Employee,
  customFieldGates?: Map<string, string[]>,
): boolean {
  /* source_type='employee' のタグのみゲート判定対象。
     カスタムフィールドも source_type='employee' + source_field=field_key で扱う。
     tenant/form_data/fixed は employee 個別の状態に依存しないので除外。 */
  const requiredEmployeeTags = (template.mapping ?? []).filter(
    (m) => m.required === true && m.source_type === 'employee',
  );

  if (requiredEmployeeTags.length === 0) {
    /* employee 紐付けの required タグが無い書類 = 全員無条件で対象（共通書類）。
       ※「全員任意」を表現したければ、どのタグも required=false にする */
    return true;
  }

  /* OR: 1 つでも該当タグがあれば書類は該当 */
  return requiredEmployeeTags.some((tag) =>
    isFieldApplicable(employee, tag.source_field, customFieldGates),
  );
}
