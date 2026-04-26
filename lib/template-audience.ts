/**
 * 書類テンプレ配布対象ヘルパー (migration 122)
 *
 * モデル:
 *   - document_template_audience: 1 書類につき 0..N 行、各行は OR 条件
 *   - 0 行 = 全員対象（デフォルト）
 *   - rule_type: flag / facility / role / employee
 *
 * 「グループ」という概念を持たず、書類自体にルールを直接付ける。
 */

import type { Employee, AudienceRuleType, DocumentTemplateAudience } from '@/lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AudienceRule {
  rule_type: AudienceRuleType;
  rule_value: string;
}

/**
 * employees の boolean 列で判定可能なフラグ（UI のチェックボックス候補）
 */
export const FLAG_OPTIONS: { value: string; label: string }[] = [
  { value: 'has_car_commute', label: 'マイカー通勤者' },
  { value: 'is_shuttle_driver', label: '送迎ドライバー' },
];

/**
 * 単一社員が単一ルールにマッチするか
 */
export function matchesRule(employee: Employee, rule: AudienceRule): boolean {
  switch (rule.rule_type) {
    case 'flag': {
      const v = (employee as unknown as Record<string, unknown>)[rule.rule_value];
      return v === true;
    }
    case 'facility':
      return employee.facility_id === rule.rule_value;
    case 'role':
      return employee.role === rule.rule_value;
    case 'employee':
      return employee.id === rule.rule_value;
    default:
      return false;
  }
}

/**
 * 書類が当該社員に配布対象か判定。
 * - 紐付くルールが 0 件 → 全員対象（true）
 * - 1 件以上 → いずれかのルールに該当（OR）
 */
export function isEmployeeInAudience(
  templateId: string,
  employee: Employee,
  audienceByTemplate: Map<string, AudienceRule[]>,
): boolean {
  const rules = audienceByTemplate.get(templateId);
  if (!rules || rules.length === 0) return true; /* 全員対象 */
  return rules.some((r) => matchesRule(employee, r));
}

/**
 * テンプレ複数件分のオーディエンスルールを一括取得。
 */
export async function loadTemplateAudience(
  supabase: SupabaseClient,
  templateIds: string[],
): Promise<Map<string, AudienceRule[]>> {
  const result = new Map<string, AudienceRule[]>();
  if (templateIds.length === 0) return result;
  const { data } = await supabase
    .from('document_template_audience')
    .select('template_id, rule_type, rule_value')
    .in('template_id', templateIds);
  for (const row of (data || []) as Pick<DocumentTemplateAudience, 'template_id' | 'rule_type' | 'rule_value'>[]) {
    let arr = result.get(row.template_id);
    if (!arr) {
      arr = [];
      result.set(row.template_id, arr);
    }
    arr.push({ rule_type: row.rule_type, rule_value: row.rule_value });
  }
  return result;
}

/**
 * 1 書類分のルールを総入れ替え保存（DELETE + INSERT）。
 * UI で「保存」ボタンが押された時の処理。
 */
export async function saveTemplateAudience(
  supabase: SupabaseClient,
  templateId: string,
  rules: AudienceRule[],
): Promise<{ error: Error | null }> {
  const del = await supabase
    .from('document_template_audience')
    .delete()
    .eq('template_id', templateId);
  if (del.error) return { error: del.error as unknown as Error };
  if (rules.length === 0) return { error: null };
  const ins = await supabase
    .from('document_template_audience')
    .insert(rules.map((r) => ({ template_id: templateId, rule_type: r.rule_type, rule_value: r.rule_value })));
  if (ins.error) return { error: ins.error as unknown as Error };
  return { error: null };
}

/**
 * バッジ表示用のラベル + 対象人数を計算。
 */
export function summarizeAudience(
  templateId: string,
  audienceByTemplate: Map<string, AudienceRule[]>,
  employees: Employee[],
): { kind: 'all' | 'rules'; count: number; label: string } {
  const rules = audienceByTemplate.get(templateId);
  const count = employees.filter((e) =>
    !rules || rules.length === 0 ? true : rules.some((r) => matchesRule(e, r)),
  ).length;
  if (!rules || rules.length === 0) {
    return { kind: 'all', count, label: '全員' };
  }
  return { kind: 'rules', count, label: '条件で絞る' };
}
