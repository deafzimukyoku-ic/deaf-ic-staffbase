import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { NotificationContentType } from '@/lib/types';

const VALID_TYPES: NotificationContentType[] = ['announcement', 'compliance', 'training', 'manual'];

// POST /api/notifications/cancel
// Body: { content_type, content_id }
// 削除時に呼ぶ。未送信キューをcancelled_atセットで無効化
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

  const { error } = await supabase
    .from('notification_queue')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .is('sent_at', null)
    .is('cancelled_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: 'cancelled' });
}
