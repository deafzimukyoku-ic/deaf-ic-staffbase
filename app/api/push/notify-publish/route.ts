import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { notifyPublishNew, notifyPublishImportantUpdate } from '@/lib/notifications/dispatcher';
import type { PublishContentType } from '@/lib/notifications/event-codes';

/**
 * POST /api/push/notify-publish
 * E1 (publish_new) / E2 (publish_important_update) のエントリポイント。
 * 仕様: docs/features/push-notifications-v2-deafic.md
 */

const ALLOWED_TYPES: ReadonlyArray<PublishContentType> = [
  'announcement', 'compliance', 'training', 'manual',
];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('employees')
    .select('role, tenant_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || (me.role !== 'admin' && me.role !== 'manager')) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    content_type?: PublishContentType;
    item_id?: string;
    mode?: 'publish' | 'important_update';
  };
  const ct = body.content_type;
  const itemId = body.item_id;
  const mode = body.mode ?? 'publish';
  if (!ct || !ALLOWED_TYPES.includes(ct)) {
    return NextResponse.json({ error: 'content_type が不正です' }, { status: 400 });
  }
  if (!itemId) {
    return NextResponse.json({ error: 'item_id が必要です' }, { status: 400 });
  }

  try {
    if (mode === 'important_update') {
      const result = await notifyPublishImportantUpdate(ct, itemId);
      return NextResponse.json({ success: true, mode, ...result });
    } else {
      const result = await notifyPublishNew(ct, itemId);
      return NextResponse.json({ success: true, mode, ...result });
    }
  } catch (err) {
    console.error('[notify-publish] failed', err);
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });
  }
}
