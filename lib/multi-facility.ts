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
 * シフト表 / 休み希望表示で「この事業所の職員一覧」を組むときに使用。
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
