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
 * 指定 facility に所属する全職員 ID（主所属 + 兼任先）を返す。
 *
 * 注意: 取得後に from('employees').select(...).in('id', memberIds) しても
 *   employees の RLS で manager / shift_manager は自分の行しか見えない。
 *   行データ自体が必要なら fetchFacilityMembers を使うこと。
 *   この関数は ID 配列だけで足りる用途（assignments の結合キー判定など）専用。
 *
 * 実装: SECURITY DEFINER RPC `get_facility_member_ids` 経由（migration 154）。
 */
export async function fetchFacilityMemberIds(
  supabase: SupabaseClient,
  facilityId: string
): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_facility_member_ids', {
    p_facility_id: facilityId,
  });
  if (error) {
    console.error('[fetchFacilityMemberIds] RPC error', error);
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * 指定 facility に所属する全職員（主所属 + 兼任先）の運用属性を返す。
 *
 * SECURITY DEFINER RPC `get_facility_members` 経由（migration 155）。
 * シフト・送迎・職員管理 UI で必要な列のみ。住所・電話など機密項目は含まない。
 *
 * 戻り値の型: 各画面で必要な列を持つ。呼び出し側で StaffRow / EmployeeRow にキャスト or マッピング。
 */
export interface FacilityMemberRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
  employee_number: string | null;
  last_name: string;
  first_name: string;
  email: string | null;
  role: string;
  status: string;
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
 *
 * 実装: facility ごとに get_facility_member_ids RPC を並列呼び出しして union。
 */
export async function fetchEmployeeIdsForFacilities(
  supabase: SupabaseClient,
  facilityIds: string[]
): Promise<string[]> {
  if (facilityIds.length === 0) return [];
  const results = await Promise.all(
    facilityIds.map((fid) =>
      supabase.rpc('get_facility_member_ids', { p_facility_id: fid }),
    ),
  );
  const ids = new Set<string>();
  for (const { data, error } of results) {
    if (error) {
      console.error('[fetchEmployeeIdsForFacilities] RPC error', error);
      continue;
    }
    for (const r of ((data ?? []) as { id: string }[])) ids.add(r.id);
  }
  return Array.from(ids);
}
