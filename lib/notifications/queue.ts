import type { NotificationContentType } from '@/lib/types';

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
