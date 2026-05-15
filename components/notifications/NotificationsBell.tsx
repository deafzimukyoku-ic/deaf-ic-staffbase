'use client';

/**
 * 完了通知ベル (admin / manager 共通)。
 * 画面右上ヘッダに配置。クリックでドロップダウン表示、未読件数バッジ付き。
 */
import { useState } from 'react';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { EVENT_META, type NotificationRow } from '@/lib/notifications/types';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, loading, refresh, markAsRead, markAllAsRead } = useNotifications(50);

  function toggle() {
    if (!open) void refresh();
    setOpen(!open);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-diletto-gray/10 transition-colors"
        aria-label={`通知 ${unreadCount > 0 ? `(${unreadCount} 件未読)` : ''}`}
        title={`通知 ${unreadCount > 0 ? `(${unreadCount} 件未読)` : ''}`}
      >
        <span className="text-lg">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 背景 click outside で閉じる。
              シフト表 / 送迎表 / 利用表 の sticky 角セルが z-50 のため、背景は z-[80] に
              引き上げないと sticky 越しに click が貫通せず外側クリックで閉じない。 */}
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />

          {/* モバイル: ベルは画面右端ではなくヘッダー中央寄りにあるため absolute right-0 だと
              画面左外にはみ出す。lg 未満は fixed で画面幅にフィットさせ、lg 以上は従来の
              ベル基準ドロップダウンに戻す。
              z-[90]: ShiftGridFull / ScheduleGridFull / ReportMatrix / StaffChildOverlapView の
              sticky 列・角セル (z-30〜z-50) を確実に上書きする。背景 bg-white で完全に opaque。 */}
          <div className="fixed left-2 right-2 top-[60px] z-[90] max-h-[70vh] overflow-y-auto rounded-lg border border-diletto-gray/15 bg-white shadow-xl lg:absolute lg:left-auto lg:right-0 lg:top-11 lg:w-[360px] lg:max-w-[calc(100vw-2rem)]">
            <div className="sticky top-0 bg-white border-b border-diletto-gray/10 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">通知</span>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-diletto-red/10 text-diletto-red text-[10px] font-bold">
                    {unreadCount} 件未読
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-[11px] font-bold text-diletto-blue hover:underline"
                >
                  全て既読にする
                </button>
              )}
            </div>

            {loading ? (
              <div className="px-4 py-12 text-center text-sm text-diletto-gray-light">読み込み中...</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-diletto-gray-light">通知はありません</div>
            ) : (
              <ul>
                {notifications.map((n) => (
                  <NotificationListItem key={n.id} notification={n} onClick={() => void markAsRead(n.id)} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NotificationListItem({ notification, onClick }: { notification: NotificationRow; onClick: () => void }) {
  const meta = EVENT_META[notification.event_type];
  const isUnread = !notification.read_at;
  const when = new Date(notification.created_at).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <li
      onClick={onClick}
      className={`px-4 py-3 border-b border-diletto-gray/5 last:border-b-0 cursor-pointer hover:bg-diletto-beige/40 transition-colors ${
        isUnread ? 'bg-diletto-blue/[0.04]' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base shrink-0 mt-0.5">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-diletto-blue uppercase tracking-wider">{meta.label}</span>
            {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-diletto-red" />}
            <span className="text-[10px] text-diletto-gray-light ml-auto">{when}</span>
          </div>
          <p className="text-sm leading-snug mt-0.5 text-diletto-ink">
            <span className="font-bold">{notification.actor_name || '社員'}</span>
            {notification.actor_facility_name && (
              <span className="text-diletto-gray-light"> ({notification.actor_facility_name})</span>
            )}
            <span> が </span>
            <span className="font-medium">「{notification.event_target_title || '（無題）'}」</span>
            <span>{meta.verb}</span>
          </p>
        </div>
      </div>
    </li>
  );
}
