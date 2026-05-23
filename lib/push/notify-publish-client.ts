/**
 * 公開・重要更新時のプッシュ通知トリガー（クライアント側ヘルパー / deaf-ic）。
 */

type ContentType = 'announcement' | 'compliance' | 'training' | 'manual';
type NotifyMode = 'publish' | 'important_update';

export async function notifyPushOnPublish(
  contentType: ContentType,
  itemId: string,
  mode: NotifyMode = 'publish',
): Promise<void> {
  try {
    await fetch('/api/push/notify-publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: contentType, item_id: itemId, mode }),
    });
  } catch (err) {
    console.warn('[push] notify-publish failed', err);
  }
}
