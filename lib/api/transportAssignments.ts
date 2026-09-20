/**
 * 送迎割当（transport_assignments）取得の canonical ヘルパー。
 *
 * ここを唯一の取得経路にしている理由（2026-09-20 の本番バグ）:
 * 送迎表 / 日次出力 / 週間送迎表 は `.eq('facility_id', …)` だけで
 * 「その施設の全期間」を引いていた。パズルの行数が 1115 行に達した時点で
 * PostgREST の暗黙 max-rows(1000) に当たり、**エラー無しで 115 行が欠落**。
 * Postgres は UPDATE のたびに行を物理末尾へ書き直すため、
 * 「今保存した行ほど 1000 番の外に押し出される」＝ 保存しても画面に戻らない、になっていた。
 *
 * 対策は 2 段構え:
 * 1. date 範囲を **必須引数** にして、そもそも全期間を引けなくする（埋め込み inner join で DB 側フィルタ）
 * 2. それでも上限に依存しないよう `fetchAllRows` でページング取得する
 *
 * 新しい画面を作るときも `.from('transport_assignments').select()` を直接書かず、必ずここを使うこと。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/multi-facility';
import type { TransportAssignmentRow } from '@/lib/types';

/** 埋め込み inner join のぶんだけ行に余計なキーが乗るので、剥がしてから返す */
type JoinedRow = TransportAssignmentRow & { schedule_entries?: unknown };

/**
 * 指定施設の、指定日付範囲（schedule_entries.date 基準・両端含む）の送迎割当を全件取得する。
 *
 * @param from 'YYYY-MM-DD'（含む）
 * @param to   'YYYY-MM-DD'（含む）。単日なら from と同じ値を渡す
 */
export async function fetchTransportAssignments(
  supabase: SupabaseClient,
  facilityId: string,
  from: string,
  to: string,
): Promise<TransportAssignmentRow[]> {
  const rows = await fetchAllRows<JoinedRow>(() =>
    supabase
      .from('transport_assignments')
      .select('*, schedule_entries!inner(date)')
      .eq('facility_id', facilityId)
      .gte('schedule_entries.date', from)
      .lte('schedule_entries.date', to)
      /* ページ間で並びがぶれると .range() の取りこぼし・重複が起きるため順序を固定する */
      .order('id', { ascending: true }),
  );
  return rows.map((row) => {
    const copy = { ...row };
    delete copy.schedule_entries;
    return copy as TransportAssignmentRow;
  });
}
