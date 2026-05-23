'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/* /my/profile (基本情報タブ) 最上部に固定表示するスマホ通知セクション。
 *
 * 状態モデル:
 *   - unsupported: ブラウザが Service Worker / Push API 非対応 (古い iOS Safari / プライベートブラウジング等)
 *   - ios_no_standalone: iOS Safari でホーム画面追加していない (Apple 仕様で Push 不可)
 *   - denied: ユーザーが通知を拒否済 (ブラウザ設定変更が必要)
 *   - off: 対応ブラウザだが未許可 / 未 subscribe
 *   - on: この端末で subscribe 済 (push_subscriptions に endpoint が登録されている)
 */
type Status = 'loading' | 'unsupported' | 'ios_no_standalone' | 'denied' | 'off' | 'on';

function detectIosStandaloneNeeded(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  if (!isIos) return false;
  /* iOS で Safari standalone でない = ホーム画面追加していない */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const standalone = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return !standalone;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function PushSubscriptionSection() {
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (typeof window === 'undefined') return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    if (detectIosStandaloneNeeded()) {
      setStatus('ios_no_standalone');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? 'on' : 'off');
    } catch {
      setStatus('off');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubscribe() {
    setBusy(true);
    try {
      /* 通知許可をリクエスト */
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast.error('通知が許可されませんでした。ブラウザの設定から通知を許可してください');
        await refresh();
        return;
      }

      /* VAPID 公開鍵を取得 */
      const keyRes = await fetch('/api/push/public-key');
      if (!keyRes.ok) {
        toast.error('プッシュ通知の設定が見つかりません。管理者に連絡してください');
        return;
      }
      const { publicKey } = await keyRes.json();
      if (!publicKey) {
        toast.error('プッシュ通知の設定が不足しています');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      /* TS の DOM 型 (BufferSource) は ArrayBuffer ベース、urlBase64ToUint8Array は
         ArrayBufferLike (SharedArrayBuffer も含む) を返し得るためキャストする */
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error('通知の登録に失敗しました', { description: j.error || '' });
        return;
      }

      toast.success('この端末で通知を受け取れるようになりました');
      setStatus('on');
    } catch (e) {
      toast.error('通知の登録に失敗しました', { description: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setStatus('off');
        return;
      }
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      toast.success('この端末の通知をオフにしました');
      setStatus('off');
    } catch (e) {
      toast.error('通知の解除に失敗しました', { description: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  }

  const statusText = (() => {
    switch (status) {
      case 'loading': return '確認中...';
      case 'unsupported': return 'このブラウザはプッシュ通知に対応していません。';
      case 'ios_no_standalone': return 'iPhone / iPad は「ホーム画面に追加」してから開き直すと通知を受け取れます。';
      case 'denied': return 'ブラウザで通知が拒否されています。ブラウザの設定から通知を許可してください。';
      case 'off': return 'この端末では受信していません。';
      case 'on': return 'この端末で受信しています。';
    }
  })();

  /* オン/オフボタンの活性条件 */
  const canSubscribe = status === 'off';
  const canUnsubscribe = status === 'on';

  return (
    <div className="mb-4 rounded-lg border border-brand-gray/10 bg-white p-4 sm:p-5 flex items-start sm:items-center gap-3 sm:gap-4 flex-col sm:flex-row">
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-bold text-brand-ink">スマホ通知</h2>
        <p className="text-xs text-brand-gray-light mt-1 leading-relaxed">
          お知らせ・遵守事項・研修・業務マニュアルが公開されたときに通知します。{statusText}
        </p>
      </div>
      <div className="shrink-0 self-end sm:self-auto">
        {canSubscribe && (
          <Button onClick={handleSubscribe} disabled={busy} size="sm" aria-label="スマホ通知をオンにする">
            {busy ? '処理中...' : 'オンにする'}
          </Button>
        )}
        {canUnsubscribe && (
          <Button onClick={handleUnsubscribe} disabled={busy} size="sm" variant="outline" aria-label="スマホ通知をオフにする">
            {busy ? '処理中...' : 'オフにする'}
          </Button>
        )}
      </div>
    </div>
  );
}
