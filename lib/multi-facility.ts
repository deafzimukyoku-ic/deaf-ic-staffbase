/**
 * 複数事業所所属（兼任）対応のクライアント側ヘルパー（migration 130/131）
 *
 * employees.facility_id (主所属) と employee_facilities (兼任先) を合成して、
 * 自分の所属する全 facility_id 集合を返す。
 *
 * employee 側コンテンツフィルタ（compliance / announcements / trainings / manuals）で
 * 「兼任先のお知らせも届く」を実現するために使用。
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 指定 employee_id の全所属 facility_id (主所属 + 兼任先) を返す。
 * 順序: [primary, ...additional]。primary が NULL なら兼任先のみ。
 */
export async function fetchMyFacilityIds(
  supabase: SupabaseClient,
  employeeId: string,
  primaryFacilityId: string | null
): Promise<string[]> {
  const { data: additional } = await supabase
    .from('employee_facilities')
    .select('facility_id')
    .eq('employee_id', employeeId);

  const ids = new Set<string>();
  if (primaryFacilityId) ids.add(primaryFacilityId);
  for (const row of additional ?? []) {
    if (row.facility_id) ids.add(row.facility_id);
  }
  return Array.from(ids);
}

/**
 * target_facility_ids (配信対象) と myFacilityIds (自分の所属) の積集合があるか。
 * target_type='all' の場合は呼び出し元で別途 true を返すこと（この関数は facility 配信専用）。
 */
export function facilityTargetsMatchMine(
  targetFacilityIds: string[] | null | undefined,
  myFacilityIds: string[]
): boolean {
  if (!targetFacilityIds || targetFacilityIds.length === 0) return false;
  return targetFacilityIds.some((f) => myFacilityIds.includes(f));
}

/**
 * 4機能 (compliance / training / announcement / manual) の audience 判定統一ヘルパー。
 * - target_type='all' でも target_position_ids が指定されていれば、その position の社員のみ対象
 * - target_type='facility' は myFacilityIds との積集合判定 + position も AND で評価
 *
 * 旧 applyScopeFilter (FacilityScopeSelector.tsx) は単一 facility_id 比較 + position 無視 + 兼任未対応
 * だったため、layout tab badge / admin・mgr dashboard / ReportMatrix で「他施設限定アイテムが
 * カウントされる」「兼任先アイテムが届かない」「position 限定アイテムが position 違いの社員に届く」
 * の問題が起きていた。判定ロジックを 1 ヶ所に集約することで再発防止。
 */
export function isItemInAudience(
  item: {
    target_type: 'all' | 'facility';
    target_facility_ids?: string[] | null;
    target_position_ids?: string[] | null;
  },
  myFacilityIds: string[],
  myPositionId: string | null,
): boolean {
  /* facility フィルタ */
  if (item.target_type === 'facility') {
    if (!facilityTargetsMatchMine(item.target_facility_ids, myFacilityIds)) return false;
  }
  /* position フィルタ (target_type='all' / 'facility' どちらでも、position 指定があれば AND) */
  if (item.target_position_ids && item.target_position_ids.length > 0) {
    if (!myPositionId) return false;
    if (!item.target_position_ids.includes(myPositionId)) return false;
  }
  return true;
}

/**
 * 指定 facility に所属する全職員 ID（主所属 + 兼任先）を返す。
 * シフト表 / 休み希望表示で「この事業所の職員一覧」を組むときに使用。
 *
 * 注意: shift_manager / manager で呼ぶと employees の RLS により自分の行しか
 * 取れない。続けて `from('employees').select(...).in('id', memberIds)` を呼ぶと
 * RLS で再び弾かれるため、行データが必要な箇所では fetchFacilityMembers を使うこと。
 */
export async function fetchFacilityMemberIds(
  supabase: SupabaseClient,
  facilityId: string
): Promise<string[]> {
  const [{ data: primary }, { data: additional }] = await Promise.all([
    supabase.from('employees').select('id').eq('facility_id', facilityId),
    supabase.from('employee_facilities').select('employee_id').eq('facility_id', facilityId),
  ]);
  const ids = new Set<string>();
  for (const r of primary ?? []) ids.add(r.id);
  for (const r of additional ?? []) ids.add(r.employee_id);
  return Array.from(ids);
}

/**
 * migration 154 で追加した SECURITY DEFINER RPC `get_facility_members(uuid)` の戻り値型。
 * employees テーブルから機密項目（住所・電話・birth_date・銀行口座・保険番号）を
 * 除いた、シフト・送迎・職員管理 UI で必要な列だけを返す。
 */
export interface FacilityMemberRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
  employee_number: string | null;
  last_name: string | null;
  first_name: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  employment_type: string | null;
  default_start_time: string | null;
  default_end_time: string | null;
  pickup_transport_areas: string[] | null;
  dropoff_transport_areas: string[] | null;
  qualifications: string[] | null;
  shift_qualifications: string[] | null;
  is_qualified: boolean | null;
  is_driver: boolean | null;
  is_attendant: boolean | null;
  shift_display_order: number | null;
  join_date: string | null;
  employee_position: string | null;
}

/**
 * 指定 facility に所属する職員（主所属 + 兼任）の行データを返す。
 * SECURITY DEFINER RPC `get_facility_members` 経由なので、shift_manager / manager が
 * employees の RLS に弾かれる問題を回避できる（migration 154）。
 *
 * 認可は RPC 側で実施: admin は同テナント内任意 facility / manager・shift_manager は
 * get_my_managed_facility_ids() 範囲 / employee は空配列。
 */
export async function fetchFacilityMembers(
  supabase: SupabaseClient,
  facilityId: string
): Promise<FacilityMemberRow[]> {
  const { data, error } = await supabase.rpc('get_facility_members', {
    p_facility_id: facilityId,
  });
  if (error) {
    console.error('[fetchFacilityMembers] RPC error', error);
    return [];
  }
  return (data ?? []) as FacilityMemberRow[];
}

/**
 * 複数 facility の和集合に所属する全職員 ID（主所属 + 兼任先）を返す。
 * mgr/subordinates 等の管理画面で manager の管轄施設群から職員一覧を組むときに使用。
 */
export async function fetchEmployeeIdsForFacilities(
  supabase: SupabaseClient,
  facilityIds: string[]
): Promise<string[]> {
  if (facilityIds.length === 0) return [];
  const [{ data: primary }, { data: additional }] = await Promise.all([
    supabase.from('employees').select('id').in('facility_id', facilityIds),
    supabase.from('employee_facilities').select('employee_id').in('facility_id', facilityIds),
  ]);
  const ids = new Set<string>();
  for (const r of primary ?? []) ids.add(r.id);
  for (const r of additional ?? []) ids.add(r.employee_id);
  return Array.from(ids);
}

/**
 * PostgREST の暗黙の max-rows(=1000) で結果が黙って打ち切られるのを防ぐページング取得。
 *
 * 背景（2026-06-01 バグ）: 兼任職員が施設シフト表 (MyFacilityShiftView) を開くと
 * `.in('facility_id', facIds)`（主+兼任先の複数施設）で shift_assignments を引くが、
 * 3 施設 × 1 ヶ月で 1052 行 > 1000 となり PostgREST が 1000 行で打ち切り → 表が「途中まで」。
 * `.limit()` も `.range()` も付けていなかったため暗黙上限を踏んでいた。
 *
 * この関数は `.range(offset, offset+PAGE-1)` で PAGE 件ずつ全件ループ取得し、上限に依存しない。
 *
 * @param build range を適用するクエリビルダを返す関数。呼ぶたびに新しいクエリを返すこと
 *   （同じ PostgrestFilterBuilder を使い回すと range 条件が積算されるため）。
 */
export async function fetchAllRows<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break; // 最終ページ
  }
  return out;
}
