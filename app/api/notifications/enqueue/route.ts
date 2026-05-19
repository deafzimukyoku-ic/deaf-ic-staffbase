import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { NotificationContentType } from '@/lib/types';

const VALID_TYPES: NotificationContentType[] = ['announcement', 'compliance', 'training', 'manual'];

/* 180: ローリングウィンドウ集約。
   - DELAY_HOURS=2: 連投が止まってから送信までの待ち時間
   - MAX_DELAY_HOURS=6: 最初の投稿から強制送信までの上限 (hardCap)
   旧仕様は投稿ごとに独立 scheduled_at を設定し、同テナント他 pending 行を
   再スケジュールしなかったため、cron が別 tick で 1 通ずつ送ってしまう問題があった。
   新仕様では新規/編集時に同テナントの未送信行を全て同じ scheduled_at に揃え、
   最古行の first_scheduled_at + MAX_DELAY_HOURS を hardCap として永遠の繰延を防ぐ。 */
const DELAY_HOURS = 2;
const MAX_DELAY_HOURS = 6;

/**
 * 夜間時間帯 (JST 23:00-07:00) はメール送信を抑止する。
 * scheduled_at が quiet 範囲内なら翌朝 07:00 JST に押し戻す。
 *
 * 仕様:
 *   - JST 07:00〜22:59 → そのまま (送信 OK 帯)
 *   - JST 23:00〜23:59 → 翌日 JST 07:00 に push
 *   - JST 00:00〜06:59 → 同日 JST 07:00 に push
 *
 * dispatcher 側 (app/api/cron/send-notifications/route.ts) でも同等の
 * safety net を持ち、scheduled_at < now() でも quiet なら send を skip する。
 */
function shiftOutOfQuietHoursJst(d: Date): Date {
  /* JST = UTC+9。Date オブジェクトは UTC ベースなので +9h して JST 時刻にずらしてから判定 */
  const jstMs = d.getTime() + 9 * 3600_000;
  const jst = new Date(jstMs);
  const h = jst.getUTCHours();
  if (h >= 23 || h < 7) {
    const target = new Date(jst);
    if (h >= 23) target.setUTCDate(target.getUTCDate() + 1);
    target.setUTCHours(7, 0, 0, 0);
    return new Date(target.getTime() - 9 * 3600_000);
  }
  return d;
}

// POST /api/notifications/enqueue
// Body: { content_type, content_id }
// 作成/編集/連投時に呼ぶ。同テナントの未送信行を全部 rolling window で揃える
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

  const now = new Date();
  const proposedScheduled = new Date(now.getTime() + DELAY_HOURS * 3600_000);

  /* 同テナントの未送信行のうち最古の first_scheduled_at を取得 (hardCap 計算用) */
  const { data: oldest } = await supabase
    .from('notification_queue')
    .select('first_scheduled_at')
    .eq('tenant_id', me.tenant_id)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .order('first_scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  /* hardCap: 最初の投稿から MAX_DELAY_HOURS で必ず送る。proposed が超えていれば丸める */
  let finalScheduled = proposedScheduled;
  if (oldest?.first_scheduled_at) {
    const firstAt = new Date(oldest.first_scheduled_at as string);
    const hardCap = new Date(firstAt.getTime() + MAX_DELAY_HOURS * 3600_000);
    if (proposedScheduled > hardCap) finalScheduled = hardCap;
  }
  /* 夜間 (JST 23:00-07:00) は送信抑止。scheduled_at をその範囲外に押し出す。
     hardCap によって quiet 範囲に丸められた場合でも、この shift で更に翌朝に押し戻すので
     「夜間に必ず送れ」(hardCap) より「夜間は絶対送らない」が優先される設計。 */
  finalScheduled = shiftOutOfQuietHoursJst(finalScheduled);
  const finalIso = finalScheduled.toISOString();

  /* 既存 (content_type, content_id) があれば UPDATE (= 同じ行のタイマーリセット)。
     first_scheduled_at は触らない (上限カウントの起点を保持) */
  const { data: existing } = await supabase
    .from('notification_queue')
    .select('id')
    .eq('content_type', contentType)
    .eq('content_id', contentId)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .maybeSingle();

  let myRowId: string;
  if (existing) {
    const { error } = await supabase
      .from('notification_queue')
      .update({ scheduled_at: finalIso, created_by: me.id })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    myRowId = existing.id as string;
  } else {
    const { data: inserted, error } = await supabase
      .from('notification_queue')
      .insert({
        tenant_id: me.tenant_id,
        content_type: contentType,
        content_id: contentId,
        scheduled_at: finalIso,
        first_scheduled_at: now.toISOString(),
        created_by: me.id,
      })
      .select('id')
      .single();
    if (error || !inserted) {
      return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });
    }
    myRowId = inserted.id as string;
  }

  /* 同テナントの他の未送信行も新しい scheduled_at に揃える (ローリングウィンドウ集約)。
     hardCap が適用されたケース (finalScheduled < proposedScheduled) では、
     他行も同時に hardCap に押し戻され、最古行の MAX_DELAY_HOURS 上限が全行に効く */
  await supabase
    .from('notification_queue')
    .update({ scheduled_at: finalIso })
    .eq('tenant_id', me.tenant_id)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .neq('id', myRowId);

  return NextResponse.json({
    status: existing ? 'updated' : 'created',
    scheduled_at: finalIso,
  });
}
