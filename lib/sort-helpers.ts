import type { SupabaseClient } from '@supabase/supabase-js';

// 指定 tenant 内での MAX(sort_order) + 1 を返す（新規作成時に末尾へ配置）
// sort_order カラムが未適用の DB でも壊れないよう、エラー時は null を返す
export async function nextSortOrder(
  supabase: SupabaseClient,
  table: 'compliance_documents' | 'trainings' | 'announcements' | 'manuals',
  tenantId: string,
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const max = (data as { sort_order?: number | null } | null)?.sort_order ?? 0;
    return max + 1;
  } catch {
    return null;
  }
}
