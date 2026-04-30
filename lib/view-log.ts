import type { SupabaseClient } from '@supabase/supabase-js';

export type ViewLogTable =
  | 'compliance_view_logs'
  | 'training_view_logs'
  | 'announcement_view_logs'
  | 'manual_view_logs';

export interface ViewSummary {
  count: number;
  lastAt: string | null;
}

/**
 * employee が「✓ 確認しました」ボタンをクリックした時に呼び出す。
 * 旧仕様（モーダル開いた瞬間に自動カウント）は廃止。明示的なクリックのみ計上。
 * 失敗時は握りつぶし、本処理を止めない（閲覧ログは付随的・障害時にも UI を妨げない）。
 */
export async function logView(
  supabase: SupabaseClient,
  table: ViewLogTable,
  payload: { tenant_id: string; employee_id: string; item_id: string }
): Promise<void> {
  try {
    await supabase.from(table).insert(payload);
  } catch {
    /* noop */
  }
}

/**
 * 自分の閲覧ログ件数 + 最終閲覧時刻 を item ごとに集計して返す。
 * モーダル内ボタンの「確認しました（N 回目）」表示用。
 */
export async function fetchMyViewSummary(
  supabase: SupabaseClient,
  table: ViewLogTable,
  employeeId: string
): Promise<Map<string, ViewSummary>> {
  const map = new Map<string, ViewSummary>();
  const { data } = await supabase
    .from(table)
    .select('item_id, viewed_at')
    .eq('employee_id', employeeId)
    .order('viewed_at', { ascending: false });
  for (const r of (data ?? []) as { item_id: string; viewed_at: string }[]) {
    const existing = map.get(r.item_id);
    if (existing) {
      existing.count += 1;
      /* 既存値の方が新しい（DESC ソート済み）なので lastAt は維持 */
    } else {
      map.set(r.item_id, { count: 1, lastAt: r.viewed_at });
    }
  }
  return map;
}
