import type { SupabaseClient } from '@supabase/supabase-js';

export type ViewLogTable =
  | 'compliance_view_logs'
  | 'training_view_logs'
  | 'announcement_view_logs'
  | 'manual_view_logs';

// employee が詳細モーダルを開いた瞬間に呼び出す。
// 失敗時は握りつぶし、本処理を止めない（閲覧ログは付随的・障害時にも UI を妨げない）。
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
