/* PWA Web Push 配信ヘルパー (server-side only)。
 *
 * 使い方:
 *   import { sendWebPushToEmployees } from '@/lib/push/server';
 *   await sendWebPushToEmployees(supabase, ['emp-id-1','emp-id-2'], {
 *     title: 'お知らせ', body: '新しいお知らせが届きました', url: '/my/announcements'
 *   });
 *
 * 設計:
 *   - VAPID 鍵が未設定なら warn + noop。メール送信は通常通り続行できる
 *   - Promise.allSettled で 25 件並列 chunk (Vercel Hobby 60s 上限を意識)
 *   - 410 Gone / 404 Not Found → 期限切れ。該当 row を即削除
 *   - その他失敗 → last_failed_at を記録 (次回 cron でも引き続き試す)
 *   - supabase は service_role / SSR どちらでも可 (RLS は SELECT のため insert はクライアント側)
 */
import webpush from 'web-push';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

const PARALLEL_CHUNK = 25;

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) {
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushSendResult {
  total: number;
  delivered: number;
  expired: number;
  failed: number;
}

export async function sendWebPushToEmployees(
  supabase: SupabaseLike,
  employeeIds: string[],
  payload: PushPayload,
): Promise<PushSendResult> {
  const result: PushSendResult = { total: 0, delivered: 0, expired: 0, failed: 0 };
  if (!ensureVapid()) {
    /* 鍵未設定なら何もしない。本番デプロイ前 / VAPID 入れ忘れでも cron 全体が落ちないように */
    console.warn('[push] VAPID キーが未設定のため Web Push 配信を skip');
    return result;
  }
  if (employeeIds.length === 0) return result;

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, employee_id')
    .in('employee_id', employeeIds);
  if (error) {
    console.error('[push] subscription 取得失敗', error);
    return result;
  }
  const rows = (subs ?? []) as Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    employee_id: string;
  }>;
  result.total = rows.length;
  if (rows.length === 0) return result;

  const body = JSON.stringify(payload);
  const expiredIds: string[] = [];
  const failedIds: string[] = [];
  const deliveredIds: string[] = [];

  for (let i = 0; i < rows.length; i += PARALLEL_CHUNK) {
    const chunk = rows.slice(i, i + PARALLEL_CHUNK);
    await Promise.allSettled(
      chunk.map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth },
            },
            body,
            { TTL: 60 * 60 * 24 } /* 24h 内に届かなければ破棄 */,
          );
          deliveredIds.push(row.id);
        } catch (err: unknown) {
          /* web-push のエラーは statusCode を持つ。410/404 で期限切れ判定 */
          const e = err as { statusCode?: number; message?: string };
          if (e?.statusCode === 410 || e?.statusCode === 404) {
            expiredIds.push(row.id);
          } else {
            failedIds.push(row.id);
            console.error('[push] send failed', { endpoint: row.endpoint, statusCode: e?.statusCode, message: e?.message });
          }
        }
      }),
    );
  }

  /* 期限切れ subscription は削除 (次回 cron で SELECT 対象外に) */
  if (expiredIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expiredIds);
  }
  /* 失敗 row は last_failed_at マーク (連続失敗が続けば人間が確認できるように) */
  if (failedIds.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ last_failed_at: new Date().toISOString() })
      .in('id', failedIds);
  }
  /* 成功 row は last_used_at 更新 */
  if (deliveredIds.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ last_used_at: new Date().toISOString(), last_failed_at: null })
      .in('id', deliveredIds);
  }

  result.delivered = deliveredIds.length;
  result.expired = expiredIds.length;
  result.failed = failedIds.length;
  return result;
}
