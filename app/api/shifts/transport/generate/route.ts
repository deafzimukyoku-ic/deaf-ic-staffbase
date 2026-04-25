import { NextRequest, NextResponse } from 'next/server';
import { generateTransportAssignments } from '@/lib/logic/generateTransport';
import { resolveShiftAuth } from '@/lib/auth/shift-api-helpers';
import type {
  StaffRow,
  ShiftAssignmentRow,
  ScheduleEntryRow,
  ChildRow,
  AreaLabel,
  ChildAreaEligibleStaffRow,
} from '@/lib/types';

/**
 * POST /api/shifts/transport/generate
 *
 * 送迎担当仮割り当て生成 API（shift-puzzle /api/transport/generate を deaf-ic 化）。
 *
 * 振る舞い:
 * - クライアントから渡された staff / shiftAssignments / scheduleEntries を元に、
 *   `generateTransportAssignments` で割り当てを計算
 * - child_area_eligible_staff は server-side で取得（最新状態反映）
 * - 既存の transport_assignments に対して以下の振る舞いで upsert:
 *   - is_locked=true の行はスキップ（手動編集を保護）
 *   - publish_status='published' の行はスキップ（公開済み保護）
 *   - それ以外は draft で上書き（schedule_entry_id で UPSERT）
 *
 * 認証: admin / manager のみ。manager は自 facility 固定。
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストの JSON が不正です' }, { status: 400 });
  }

  const requestedFacilityId = typeof body.facility_id === 'string' ? body.facility_id : null;

  const auth = await resolveShiftAuth({ requestedFacilityId });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const date = typeof body.date === 'string' ? body.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) は必須です' }, { status: 400 });
  }

  const scheduleEntries = (body.scheduleEntries ?? []) as ScheduleEntryRow[];
  const staff = (body.staff ?? []) as StaffRow[];
  const shiftAssignments = (body.shiftAssignments ?? []) as ShiftAssignmentRow[];
  const children = (body.children ?? []) as ChildRow[];
  const pickupAreas = (body.pickupAreas ?? []) as AreaLabel[];
  const dropoffAreas = (body.dropoffAreas ?? []) as AreaLabel[];
  const minEndTime = typeof body.minEndTime === 'string' ? body.minEndTime : undefined;
  const pickupCooldownMinutes =
    typeof body.pickupCooldownMinutes === 'number' ? body.pickupCooldownMinutes : undefined;

  /* Phase 60: child-specific エリア担当可能職員を server-side で取得 */
  const { data: eligRows } = await ctx.supabase
    .from('child_area_eligible_staff')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('facility_id', ctx.facilityId);
  const childAreaEligibleStaff = (eligRows ?? []) as ChildAreaEligibleStaffRow[];

  /* 計算 */
  const result = generateTransportAssignments({
    tenantId: ctx.tenantId,
    facilityId: ctx.facilityId,
    date,
    scheduleEntries,
    staff,
    shiftAssignments,
    minEndTime,
    children,
    pickupAreas,
    dropoffAreas,
    pickupCooldownMinutes,
    childAreaEligibleStaff,
  });

  /* 既存行の保護判定: is_locked=true / publish_status='published' は上書き禁止 */
  const entryIds = result.assignments.map((a) => a.schedule_entry_id);
  const { data: existing } = await ctx.supabase
    .from('transport_assignments')
    .select('schedule_entry_id, is_locked, publish_status')
    .eq('tenant_id', ctx.tenantId)
    .eq('facility_id', ctx.facilityId)
    .in('schedule_entry_id', entryIds.length > 0 ? entryIds : ['00000000-0000-0000-0000-000000000000']);

  const protectedIds = new Set(
    (existing ?? [])
      .filter((r) => r.is_locked || r.publish_status === 'published')
      .map((r) => r.schedule_entry_id as string)
  );

  const toUpsert = result.assignments.filter((a) => !protectedIds.has(a.schedule_entry_id));

  if (toUpsert.length > 0) {
    const { error } = await ctx.supabase
      .from('transport_assignments')
      .upsert(toUpsert, { onConflict: 'tenant_id,facility_id,schedule_entry_id' });
    if (error) {
      return NextResponse.json(
        { error: `保存に失敗しました: ${error.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    upserted: toUpsert.length,
    skippedLocked: protectedIds.size,
    unassignedCount: result.unassignedCount,
  });
}
