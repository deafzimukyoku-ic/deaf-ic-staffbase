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
 * employee が「✓ 確認しました」ボタンをクリックした時、または各カテゴリの
 * 初回 ack / markRead 時に呼ばれる。
 *
 * 旧仕様 (try/catch で握り潰し) は Supabase JS の挙動と噛み合っておらず、
 * await insert は RLS/制約違反でも throw せず { error } を返すため catch ブロックが
 * 永久未発火だった。結果として view_logs INSERT 失敗が silent failure し、
 * 閲覧レポートが「✗ 未読」のまま残る問題 (P2) の温床になっていた。
 *
 * 新仕様: error が返ってきた場合は必ず console.error に残す。UI を止めない方針は維持。
 */
export async function logView(
  supabase: SupabaseClient,
  table: ViewLogTable,
  payload: { tenant_id: string; employee_id: string; item_id: string }
): Promise<void> {
  const { error } = await supabase.from(table).insert(payload);
  if (error) {
    console.error('[logView] insert failed', { table, payload, error });
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
