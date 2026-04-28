/**
 * シフト保存ロジックの canonical ヘルパー（Phase 66+）
 *
 * 移植元: 本家 shift-puzzle Phase 65（`replaceForDay` モード）
 * 採用理由:
 * - upsert で既存セグメントを残したまま新セグメントを上書きすると、ゴミ行（off + normal 同居など）が残る
 * - segment_order の採番をクライアント側で計算するとページごとにバラついてバグの温床
 * - 「(employee_id, date) の 1 日まるごと置換」を canonical にして、segment_order は呼び出し側が並べた配列の index で確定
 *
 * deaf-ic 仕様の差分:
 * - staff_id → employee_id
 * - tenant_id 単独 → tenant_id + facility_id の複合キー
 * - publish_status 必須（draft / ready / published）
 *
 * deaf-ic は API ルートを介さず Supabase クライアント直接書き込み（既存パターン踏襲）
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftAssignmentType, PublishStatus } from '@/lib/types';

export interface ShiftSegmentInput {
  start_time: string | null;
  end_time: string | null;
  assignment_type: ShiftAssignmentType;
  note?: string | null;
}

export type ReplaceShiftDayResult =
  | { ok: true }
  | { ok: false; error: string };

export interface ReplaceShiftDayArgs {
  supabase: SupabaseClient;
  tenantId: string;
  facilityId: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  segments: ShiftSegmentInput[];
  isConfirmed: boolean;
  publishStatus: PublishStatus;
}

/**
 * 1 日まるごと置換。
 * - segments が空配列なら、その日の全セグメントを削除（完全に空に戻す）
 * - 1 件以上なら、(tenant, facility, employee, date) の既存を消してから segment_order=0..N で再採番 INSERT
 *
 * 注: DELETE + INSERT を分けて実行（Supabase JS の制約で原子性保証なし）。
 * 失敗時のロールバックは無いが、UI は再 fetch で最新化するため整合は取れる。
 */
export async function replaceShiftDay({
  supabase,
  tenantId,
  facilityId,
  employeeId,
  date,
  segments,
  isConfirmed,
  publishStatus,
}: ReplaceShiftDayArgs): Promise<ReplaceShiftDayResult> {
  if (!tenantId || !facilityId || !employeeId || !date) {
    return { ok: false, error: 'tenant / facility / employee / date は必須です' };
  }

  /* (1) 既存全セグメントを削除 */
  const { error: delErr } = await supabase
    .from('shift_assignments')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('facility_id', facilityId)
    .eq('employee_id', employeeId)
    .eq('date', date);
  if (delErr) {
    return { ok: false, error: `削除失敗: ${delErr.message}` };
  }

  /* segments が空 = その日を完全に空にする */
  if (segments.length === 0) {
    return { ok: true };
  }

  /* (2) segment_order=0..N で再採番して INSERT */
  const rows = segments.map((s, idx) => ({
    tenant_id: tenantId,
    facility_id: facilityId,
    employee_id: employeeId,
    date,
    segment_order: idx,
    start_time: s.start_time,
    end_time: s.end_time,
    assignment_type: s.assignment_type,
    is_confirmed: isConfirmed,
    publish_status: publishStatus,
    note:
      typeof s.note === 'string' && s.note.trim()
        ? s.note.trim().slice(0, 40)
        : null,
  }));

  const { error: insErr } = await supabase.from('shift_assignments').insert(rows);
  if (insErr) {
    return { ok: false, error: `登録失敗: ${insErr.message}` };
  }

  return { ok: true };
}
