import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/* POST /api/push/subscribe
 * Body: { subscription: PushSubscriptionJSON, oldEndpoint?: string }
 *
 * Service Worker の pushManager.subscribe() で得た subscription を本人の employee_id で保存する。
 * 同 endpoint が既にあれば UPSERT (last_used_at 更新)。oldEndpoint は pushsubscriptionchange の
 * 古い endpoint を渡してもらい、これを削除して新 endpoint を insert する。 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: me } = await supabase
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();
  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  const oldEndpoint = typeof body?.oldEndpoint === 'string' ? body.oldEndpoint : null;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'subscription の形式が不正です' }, { status: 400 });
  }

  const userAgent = req.headers.get('user-agent') ?? null;

  /* pushsubscriptionchange 由来: 古い行を削除 (本人のみ削除可) */
  if (oldEndpoint && oldEndpoint !== endpoint) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', oldEndpoint)
      .eq('employee_id', me.id);
  }

  /* endpoint UNIQUE で UPSERT。conflict 時は last_used_at と鍵を更新 */
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        employee_id: me.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        last_used_at: new Date().toISOString(),
        last_failed_at: null,
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
