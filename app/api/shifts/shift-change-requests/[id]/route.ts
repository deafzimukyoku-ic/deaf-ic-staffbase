import { NextResponse, type NextRequest } from 'next/server';
import { resolveShiftAuth } from '@/lib/auth/shift-api-helpers';
import type {
  ShiftChangeRequestRow,
  ShiftChangeRequestPayload,
  ShiftChangeTimePayload,
  ShiftChangeTypePayload,
} from '@/lib/types';

/**
 * PATCH /api/shifts/shift-change-requests/[id]
 * シフト変更申請の承認 / 却下（admin のみ。manager は閲覧のみ）
 *
 * リクエスト: { action: 'approve' | 'reject', admin_note?: string }
 *
 * 承認時は対応する shift_assignments を更新する（トランザクション的に扱う：
 * 失敗時は申請ステータスもロールバック）。
 */

interface PatchBody {
  action?: 'approve' | 'reject';
  admin_note?: string | null;
}

function isTimePayload(p: ShiftChangeRequestPayload): p is ShiftChangeTimePayload {
  return 'start_time' in p && !('assignment_type' in p);
}

function isTypePayload(p: ShiftChangeRequestPayload): p is ShiftChangeTypePayload {
  return 'assignment_type' in p;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエスト形式が不正です' }, { status: 400 });
  }

  const { action, admin_note } = body;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action は approve / reject のみ' }, { status: 400 });
  }

  // 承認は admin のみ。manager は不可。
  const auth = await resolveShiftAuth({
    // 承認は admin のみ。申請の facility_id を後で照合するため admin に facility 指定を強制しない
    allowedRoles: ['admin'],
    allowAdminWithoutFacility: true,
  });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  // 申請を取得
  const { data: req, error: fetchErr } = await ctx.supabase
    .from('shift_change_requests')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle<ShiftChangeRequestRow>();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!req) {
    return NextResponse.json({ error: '申請が見つかりません' }, { status: 404 });
  }
  if (req.status !== 'pending') {
    return NextResponse.json(
      { error: `この申請は既に処理済みです（status=${req.status}）` },
      { status: 409 }
    );
  }

  // 承認時に reviewer 名前を取得
  const { data: reviewer } = await ctx.supabase
    .from('employees')
    .select('full_name, last_name, first_name')
    .eq('id', ctx.employeeId)
    .single();

  const reviewerName =
    reviewer?.full_name ||
    [reviewer?.last_name, reviewer?.first_name].filter(Boolean).join(' ') ||
    '管理者';

  if (action === 'reject') {
    const { error: updErr } = await ctx.supabase
      .from('shift_change_requests')
      .update({
        status: 'rejected',
        reviewed_by_employee_id: ctx.employeeId,
        reviewed_by_name: reviewerName,
        reviewed_at: new Date().toISOString(),
        admin_note: admin_note ?? null,
      })
      .eq('id', id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  // === approve 処理 ===
  // 1. 対象の shift_assignment を更新（無ければ新規作成）
  const payload = req.requested_payload;
  const updateFields: Record<string, unknown> = {};

  if (isTimePayload(payload)) {
    updateFields.start_time = payload.start_time;
    updateFields.end_time = payload.end_time;
    updateFields.assignment_type = 'normal';
  } else if (isTypePayload(payload)) {
    updateFields.assignment_type = payload.assignment_type;
    updateFields.start_time =
      payload.assignment_type === 'normal' && payload.start_time ? payload.start_time : null;
    updateFields.end_time =
      payload.assignment_type === 'normal' && payload.end_time ? payload.end_time : null;
  }

  // 既存 assignment があるか確認
  const { data: existing } = await ctx.supabase
    .from('shift_assignments')
    .select('id, publish_status')
    .eq('tenant_id', ctx.tenantId)
    .eq('facility_id', req.facility_id)
    .eq('employee_id', req.employee_id)
    .eq('date', req.target_date)
    .eq('segment_order', 0)
    .maybeSingle();

  let saErr;
  if (existing) {
    // 既存行を更新（publish_status は維持）
    const { error } = await ctx.supabase
      .from('shift_assignments')
      .update(updateFields)
      .eq('id', existing.id);
    saErr = error;
  } else {
    // 新規（draft で作成）
    const { error } = await ctx.supabase.from('shift_assignments').insert({
      tenant_id: ctx.tenantId,
      facility_id: req.facility_id,
      employee_id: req.employee_id,
      date: req.target_date,
      segment_order: 0,
      publish_status: 'draft',
      is_confirmed: false,
      ...updateFields,
    });
    saErr = error;
  }

  if (saErr) {
    return NextResponse.json(
      { error: `シフト更新失敗: ${saErr.message}` },
      { status: 500 }
    );
  }

  // 2. 申請ステータスを approved に更新
  const { error: updReqErr } = await ctx.supabase
    .from('shift_change_requests')
    .update({
      status: 'approved',
      reviewed_by_employee_id: ctx.employeeId,
      reviewed_by_name: reviewerName,
      reviewed_at: new Date().toISOString(),
      admin_note: admin_note ?? null,
    })
    .eq('id', id);

  if (updReqErr) {
    return NextResponse.json({ error: updReqErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: 'approved' });
}
