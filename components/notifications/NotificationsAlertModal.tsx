'use client';

/**
 * 完了通知の自動ポップアップ。
 * admin / manager dashboard 初回表示時に未読がある場合のみ自動オープン。
 * sessionStorage で「同セッションで一度表示したらしばらく出さない」抑制。
 */
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { EVENT_META, FALLBACK_EVENT_META, type NotificationRow } from '@/lib/notifications/types';

const SESSION_KEY = 'notif_modal_session_seen_v1';

export function NotificationsAlertModal() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, loading, markAllAsRead } = useNotifications(50);

  /* loading 完了 + 未読あり + 同セッションで未表示 → 自動オープン */
  useEffect(() => {
    if (loading) return;
    if (unreadCount === 0) return;
    if (typeof window === 'undefined') return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return;
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* sessionStorage 使えない環境 (SSR / private browsing 一部) は素通し */
    }
    setOpen(true);
  }, [loading, unreadCount]);

  const unread = notifications.filter((n) => !n.read_at);

  if (loading || unread.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="!max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            🔔 新しい完了通知が <span className="text-brand-red">{unreadCount}</span> 件あります
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
          <ul className="space-y-2">
            {unread.slice(0, 20).map((n) => (
              <NotificationCard key={n.id} notification={n} />
            ))}
          </ul>
          {unread.length > 20 && (
            <p className="text-center text-xs text-brand-gray-light mt-3">
              ...残り {unread.length - 20} 件は右上の通知ベルから確認できます
            </p>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            className="flex-1"
          >
            あとで確認
          </Button>
          <Button
            onClick={async () => {
              await markAllAsRead();
              setOpen(false);
            }}
            className="flex-1 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold"
          >
            ✓ 全部既読にする
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotificationCard({ notification }: { notification: NotificationRow }) {
  /* 175: 未知 event_type (UI 側 EVENT_META 更新漏れ) でも落ちないよう fallback。
     根本的には EVENT_META に必ず追加するが、防衛ライン。 */
  const meta = EVENT_META[notification.event_type] ?? FALLBACK_EVENT_META;
  const when = new Date(notification.created_at).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <li className="border border-brand-gray/15 rounded-lg p-3 bg-brand-blue/[0.03]">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-brand-blue uppercase tracking-wider">{meta.label}</span>
            <span className="text-[11px] text-brand-gray-light ml-auto">{when}</span>
          </div>
          <p className="text-sm leading-relaxed mt-1">
            <span className="font-bold">{notification.actor_name || '社員'}</span>
            {notification.actor_facility_name && (
              <span className="text-brand-gray-light text-xs"> ({notification.actor_facility_name})</span>
            )}
            <span> が </span>
            <span className="font-bold">「{notification.event_target_title || '（無題）'}」</span>
            <span>{meta.verb}</span>
          </p>
        </div>
      </div>
    </li>
  );
}
