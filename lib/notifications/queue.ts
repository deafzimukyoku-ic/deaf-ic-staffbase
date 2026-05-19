import type { NotificationContentType } from '@/lib/types';

/**
 * メール通知の抑止時間帯 (JST 23:00-07:00)。enqueue 側で scheduled_at を
 * 翌朝 07:00 に push、dispatcher 側でも safety net として参照する。
 *
 * UI 文言でユーザーに明示する場合は QUIET_HOURS_LABEL を使う (= 同期した一文)。
 */
export const QUIET_HOURS_LABEL = '夜間23:00-07:00を除く';

/**
 * is_published 状態に応じて enqueue / cancel を自動で振り分け、
 * toast 表示用の状態を返す。
 *
 * 旧コードは 4 機能の admin handleSave (edit branch) で is_published 無視で
 * enqueueNotification を呼んでいたため、非公開保存時にも「2時間後にメール
 * 通知されます」toast が出て嘘 UX になっていた。本 helper で公開状態をベース
 * に統一判定して 4 機能横断で挙動を揃え、再発を防ぐ。
 *
 * - is_published=true  → enqueueNotification (2h 後送信予約、夜間は push)
 * - is_published=false → cancelNotification (未送信キューがあれば取消)
 *
 * 戻り値:
 *   { willNotify: true }  公開で保存 → 「2h 後に送信されます」toast
 *   { willNotify: false } 非公開で保存 → 「メール通知は行いません」toast
 */
export async function enqueueOrCancelByPublished(
  contentType: NotificationContentType,
  contentId: string,
  isPublished: boolean,
): Promise<{ willNotify: boolean }> {
  if (isPublished) {
    await enqueueNotification(contentType, contentId);
    return { willNotify: true };
  }
  await cancelNotification(contentType, contentId);
  return { willNotify: false };
}

// 作成/編集時に呼ぶ。2時間後に社員へメール送信予約
export async function enqueueNotification(contentType: NotificationContentType, contentId: string): Promise<void> {
  try {
    const res = await fetch('/api/notifications/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: contentType, content_id: contentId }),
    });
    if (!res.ok) {
      console.warn('[enqueueNotification] failed', await res.text());
    }
  } catch (err) {
    console.warn('[enqueueNotification] error', err);
  }
}

// 削除時に呼ぶ。未送信キューをキャンセル
export async function cancelNotification(contentType: NotificationContentType, contentId: string): Promise<void> {
  try {
    const res = await fetch('/api/notifications/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: contentType, content_id: contentId }),
    });
    if (!res.ok) {
      console.warn('[cancelNotification] failed', await res.text());
    }
  } catch (err) {
    console.warn('[cancelNotification] error', err);
  }
}
