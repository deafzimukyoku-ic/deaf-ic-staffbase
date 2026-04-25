import { NextResponse, type NextRequest } from 'next/server';
import { resolveShiftAuth } from '@/lib/auth/shift-api-helpers';
import type { PublishStatus } from '@/lib/types';

/**
 * POST /api/shifts/transition
 * シフト/送迎の publish_status 遷移 + 通知キュー enqueue
 *
 * リクエスト: { facility_id, year, month, target: 'ready' | 'published' | 'draft' | 'ready_back' }
 *  - 'ready': draft → ready (仮シフト確認依頼通知)
 *  - 'published': ready → published (公開通知)
 *  - 'ready_back': published → ready (戻し、通知なし)
 *  - 'draft': ready → draft (戻し、通知なし)
 *
 * 注意: shift_assignments と transport_assignments を連動して同じ publish_status に更新する
 *       （CLAUDE.md §10「publish_status 関連」より）
 */

type TransitionTarget = 'ready' | 'published' | 'draft' | 'ready_back';

const TRANSITION_RULES: Record<TransitionTarget, { from: PublishStatus[]; to: PublishStatus }> = {
  ready: { from: ['draft'], to: 'ready' },
  published: { from: ['ready'], to: 'published' },
  ready_back: { from: ['published'], to: 'ready' },
  draft: { from: ['ready'], to: 'draft' },
};

export async function POST(request: NextRequest) {
  let body: {
    facility_id?: string;
    year?: number;
    month?: number;
    target?: TransitionTarget;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエスト形式が不正です' }, { status: 400 });
  }

  const { facility_id, year, month, target } = body;

  if (!year || !month || !target) {
    return NextResponse.json(
      { error: 'year / month / target は必須です' },
      { status: 400 }
    );
  }

  if (!TRANSITION_RULES[target]) {
    return NextResponse.json({ error: 'target が不正です' }, { status: 400 });
  }

  const auth = await resolveShiftAuth({
    requestedFacilityId: facility_id,
    allowedRoles: ['admin', 'manager'],
  });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const rule = TRANSITION_RULES[target];

  // 月の範囲
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // 1. 現状確認: 対象月の shift_assignments で from 状態のものが1件以上あるか
  const { data: existing, error: selErr } = await ctx.supabase
    .from('shift_assignments')
    .select('id, publish_status')
    .eq('tenant_id', ctx.tenantId)
    .eq('facility_id', ctx.facilityId)
    .gte('date', from)
    .lte('date', to);

  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  if (!existing || existing.length === 0) {
    return NextResponse.json(
      { error: '対象月のシフトが存在しません。先にシフトを生成してください。' },
      { status: 400 }
    );
  }

  // 全行が遷移元状態であること（部分遷移は禁止）
  const allInFromState = existing.every((r) => rule.from.includes(r.publish_status as PublishStatus));
  if (!allInFromState) {
    const counts = existing.reduce<Record<string, number>>((acc, r) => {
      acc[r.publish_status] = (acc[r.publish_status] || 0) + 1;
      return acc;
    }, {});
    return NextResponse.json(
      {
        error: `現在のステータスが遷移元（${rule.from.join('/')}）と一致しません`,
        current: counts,
      },
      { status: 409 }
    );
  }

  // 2. shift_assignments を一括更新
  const { error: updErr1 } = await ctx.supabase
    .from('shift_assignments')
    .update({ publish_status: rule.to })
    .eq('tenant_id', ctx.tenantId)
    .eq('facility_id', ctx.facilityId)
    .gte('date', from)
    .lte('date', to);

  if (updErr1) {
    return NextResponse.json({ error: updErr1.message }, { status: 500 });
  }

  // 3. transport_assignments を連動更新（存在する分のみ）。
  //    transport_assignments は date 列を持たないため schedule_entries から該当 entry id を引いて IN で更新。
  const { data: monthEntries } = await ctx.supabase
    .from('schedule_entries')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('facility_id', ctx.facilityId)
    .gte('date', from)
    .lte('date', to);
  const monthEntryIds = (monthEntries ?? []).map((e) => e.id as string);
  if (monthEntryIds.length > 0) {
    await ctx.supabase
      .from('transport_assignments')
      .update({ publish_status: rule.to })
      .eq('tenant_id', ctx.tenantId)
      .eq('facility_id', ctx.facilityId)
      .in('schedule_entry_id', monthEntryIds);
  }

  // 4. 通知キュー enqueue（draft→ready / ready→published のみ。戻し系は通知なし）
  const queuedNotification: { kind: 'shift_ready' | 'shift_publish' } | null =
    target === 'ready' ? { kind: 'shift_ready' } :
    target === 'published' ? { kind: 'shift_publish' } :
    null;

  if (queuedNotification) {
    // 既存の未送信キューを上書き（編集再公開対応）
    await ctx.supabase
      .from('notification_queue')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('facility_id', ctx.facilityId)
      .eq('content_type', queuedNotification.kind)
      .is('sent_at', null)
      .is('cancelled_at', null)
      .filter('meta->>year', 'eq', String(year))
      .filter('meta->>month', 'eq', String(month));

    // 即時送信（scheduled_at = now）。Vercel Cron が10分以内に処理する。
    const { error: enqErr } = await ctx.supabase
      .from('notification_queue')
      .insert({
        tenant_id: ctx.tenantId,
        facility_id: ctx.facilityId,
        content_type: queuedNotification.kind,
        content_id: null,
        meta: { year, month, kind: queuedNotification.kind },
        scheduled_at: new Date().toISOString(),
        created_by: ctx.employeeId,
      });

    if (enqErr) {
      // キュー失敗でも遷移自体は成功。ログのみ。
      console.error('[shift/transition] notification enqueue failed', enqErr);
    }
  }

  return NextResponse.json({
    ok: true,
    target,
    publish_status: rule.to,
    affected: existing.length,
    notification_queued: !!queuedNotification,
  });
}
