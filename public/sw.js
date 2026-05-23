/*
 * deaf-ic Service Worker — Push 専用最小実装。
 * オフラインキャッシュは持たない (将来別フェーズで Cache API を足す)。
 *
 * イベント:
 *   - install: 即 activate (waitUntil(self.skipWaiting()))
 *   - activate: 旧 SW を即引き継ぎ (clients.claim)
 *   - push: payload JSON {title, body, url, tag?} で OS 通知を出す
 *   - notificationclick: 通知をタップしたら url にフォーカス or 新規 open
 *   - pushsubscriptionchange: subscription が期限切れになった時に再登録 → /api/push/subscribe
 *
 * Why no sound:
 *   ろう者向けアプリのため payload に音声指定を含めない。OS 標準の振動 + 視覚通知のみ。
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: '職員ステーション', body: event.data.text() };
  }

  const title = payload.title || '職員ステーション';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || undefined,
    data: { url: payload.url || '/my/dashboard' },
    /* silent:false にして OS の振動・視覚通知を有効化。音声は OS 側設定に委ねる
       (アプリ側からは sound を指定しない = ろう者向け仕様) */
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/my/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      /* 既に同オリジンのタブが開いていればそれにフォーカス + URL 移動 */
      for (const client of clientList) {
        const u = new URL(client.url);
        if (u.origin === self.location.origin && 'focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return;
        }
      }
      /* 開いてなければ新規 open */
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  /* push subscription の鍵が更新されたタイミング (再 subscribe が必要)。
     新しい subscription を作って /api/push/subscribe に POST。
     クライアント側でも refresh するが、SW が独立で更新できるとオフライン時もカバーできる */
  event.waitUntil(
    (async () => {
      try {
        const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
        /* 公開鍵を取得して再 subscribe */
        const res = await fetch('/api/push/public-key');
        if (!res.ok) return;
        const { publicKey } = await res.json();
        if (!publicKey) return;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            oldEndpoint,
          }),
        });
      } catch (e) {
        /* SW 内では console.error 残しても本番ログに混ざらない (DevTools のみ) ので可 */
        console.error('[sw] pushsubscriptionchange failed', e);
      }
    })(),
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
