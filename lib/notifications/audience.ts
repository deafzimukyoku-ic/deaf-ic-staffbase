/**
 * Push 配信用 audience 解決（deaf-ic）。
 */

import { createClient as createSbClient } from '@supabase/supabase-js';
import { isItemInAudience } from '@/lib/multi-facility';

function admin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface AudienceItem {
  target_type: 'all' | 'facility';
  target_facility_ids?: string[] | null;
  target_position_ids?: string[] | null;
}

export async function resolveAudienceEmployeeIds(
  tenantId: string,
  item: AudienceItem,
): Promise<string[]> {
  const sb = admin();
  const { data: emps } = await sb
    .from('employees')
    .select('id, facility_id, position_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  const rows = (emps as Array<{ id: string; facility_id: string | null; position_id: string | null }> | null) ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: efs } = await sb
    .from('employee_facilities')
    .select('employee_id, facility_id')
    .in('employee_id', ids);
  const fmap = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = new Set<string>();
    if (r.facility_id) s.add(r.facility_id);
    fmap.set(r.id, s);
  }
  for (const ef of (efs as Array<{ employee_id: string; facility_id: string }> | null) ?? []) {
    const set = fmap.get(ef.employee_id);
    if (set && ef.facility_id) set.add(ef.facility_id);
  }

  const out: string[] = [];
  for (const r of rows) {
    const myFacilityIds = Array.from(fmap.get(r.id) ?? []);
    if (isItemInAudience(item, myFacilityIds, r.position_id)) {
      out.push(r.id);
    }
  }
  return out;
}
