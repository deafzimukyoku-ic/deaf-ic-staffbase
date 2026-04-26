/**
 * 書類が当該社員に必要か判定（Document Applicability）
 *
 * シンプル化された新ルール（2026-04-26 改修）:
 *   - 書類に貼られた employee タグのうち「ゲート定義のあるタグ」(= 条件付き項目) を抽出
 *   - 全てのゲート付きタグについて、社員がそのゲート条件を満たしているかチェック
 *   - 全部満たす (AND) → 書類は該当
 *   - 1 つでも外れる → 書類は非該当
 *   - ゲート付きタグが 0 個 → 「無条件タグ（氏名など）だけで構成された全社員共通書類」とみなして全員対象
 *
 * 旧ロジック（OR + required フィルタ）は employee タグに required を立てる UI が
 * 存在せず実質的に「全員対象」固定になっていたため、required は判定から除外。
 * 「タグを貼る = 必要」という直感的なモデルに揃える。
 *
 * 旧 visibility_condition は migration 119 で廃止。代わりにこの関数で判定。
 */

import type { DocumentTemplate, Employee } from '@/lib/types';
import { isFieldApplicable, hasGateDefinition, GATE_FLAG_LABELS, CORE_FIELD_GATES } from '@/lib/field-applicability';
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
 *
 * 注: migration 122 で「対象グループ」機構が導入されたため、
 *     ゲート付きタグでの自動判定は legacy として残しつつ実利用は employee-groups.ts 側に移行予定。
 */
export function isDocumentApplicable(
  template: Pick<DocumentTemplate, 'mapping'>,
  employee: Employee,
  customFieldGates?: Map<string, string[]>,
): boolean {
  const gatedTags = (template.mapping ?? []).filter(
    (m) => m.source_type === 'employee' && hasGateDefinition(m.source_field, customFieldGates),
  );

  if (gatedTags.length === 0) return true; /* 全員共通書類 */

  return gatedTags.every((tag) =>
    isFieldApplicable(employee, tag.source_field, customFieldGates),
  );
}

/**
 * 書類の「対象者」を人間用ラベルで返す。/admin/documents カードに表示する用途。
 *
 * 戻り値:
 *   { kind: 'all' }                            ... ゲート付きタグなし → 全員対象
 *   { kind: 'gated', flags: ['has_car_commute', 'is_shuttle_driver'] }
 *                                              ... 「マイカー通勤者・送迎運転者」のいずれかに該当する人
 *
 * 注意: 1つの書類に複数のゲート付きタグがあった場合、それぞれが要求するフラグの「和集合」を返す。
 *      実際の判定ロジック（isDocumentApplicable）は AND だが、人間説明としては
 *      「これらの条件を満たす人だけ対象」とまとめて見せる。
 */
export function getDocumentAudience(
  template: Pick<DocumentTemplate, 'mapping'>,
  customFieldGates?: Map<string, string[]>,
): { kind: 'all' } | { kind: 'gated'; flags: string[] } {
  const gatedTags = (template.mapping ?? []).filter(
    (m) => m.source_type === 'employee' && hasGateDefinition(m.source_field, customFieldGates),
  );

  if (gatedTags.length === 0) return { kind: 'all' };

  const flagSet = new Set<string>();
  for (const tag of gatedTags) {
    const gates = CORE_FIELD_GATES[tag.source_field] ?? customFieldGates?.get(tag.source_field) ?? [];
    for (const g of gates) flagSet.add(g);
  }
  return { kind: 'gated', flags: Array.from(flagSet) };
}

/**
 * getDocumentAudience の結果を 1 行のラベル文字列に変換。
 * 例: "全員対象" / "マイカー通勤者のみ" / "マイカー通勤者・送迎運転者"
 */
export function formatAudienceLabel(
  audience: ReturnType<typeof getDocumentAudience>,
): string {
  if (audience.kind === 'all') return '全員対象';
  const labels = audience.flags.map((f) => GATE_FLAG_LABELS[f] ?? f);
  return labels.length === 1 ? `${labels[0]}のみ` : labels.join('・');
}
