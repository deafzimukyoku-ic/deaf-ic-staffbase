import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { NotificationContentType } from '@/lib/types';

const VALID_TYPES: NotificationContentType[] = ['announcement', 'compliance', 'training', 'manual'];
const DELAY_HOURS = 2;

// POST /api/notifications/enqueue
// Body: { content_type, content_id }
// 作成/編集時に呼ぶ。未送信キューがあればscheduled_atをリセット、なければ新規作成
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: me } = await supabase
    .from('employees')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (!['admin', 'manager'].includes(me.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const body = await req.json();
  const contentType = body.content_type as NotificationContentType;
  const contentId = body.content_id as string;

  if (!VALID_TYPES.includes(contentType) || !contentId) {
    return NextResponse.json({ error: 'パラメータが不正です' }, { status: 400 });
  }

  const scheduledAt = new Date(Date.now() + DELAY_HOURS * 60 * 60 * 1000).toISOString();

  // 未送信・未キャンセルの既存キューがあればUPDATE（編集扱いでタイマーリセット）
  const { data: existing } = await supabase
    .from('notification_queue')
    .select('id')
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('notification_queue')
      .update({ scheduled_at: scheduledAt, created_by: me.id })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: 'updated', scheduled_at: scheduledAt });
  }

  const { error } = await supabase
    .from('notification_queue')
    .insert({
      tenant_id: me.tenant_id,
      content_type: contentType,
      content_id: contentId,
      scheduled_at: scheduledAt,
      created_by: me.id,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: 'created', scheduled_at: scheduledAt });
}
