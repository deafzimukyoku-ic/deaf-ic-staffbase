'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { NotificationRow } from '@/lib/notifications/types';

/**
 * 完了通知を取得・既読化する共通フック。
 * - mount 時に一度 fetch
 * - bell クリック時に手動 refresh 可能
 * - 既読化は楽観的更新 + DB 反映
 *
 * 受信者本人 (auth.uid()) のみが自分宛の通知を読み書きできる
 * (notifications RLS / migration 139)。
 */
export function useNotifications(maxRows: number = 50) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [supabase] = useState(() => createClient());

  const refresh = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(maxRows);
    if (!error) {
      setNotifications((data ?? []) as NotificationRow[]);
    }
    setLoading(false);
  }, [supabase, maxRows]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function markAsRead(id: string) {
    const now = new Date().toISOString();
    /* 楽観的更新 */
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
    await supabase.from('notifications').update({ read_at: now }).eq('id', id);
  }

  async function markAllAsRead() {
    const now = new Date().toISOString();
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.from('notifications').update({ read_at: now }).in('id', unreadIds);
  }

  return {
    notifications,
    unreadCount,
    loading,
    refresh,
    markAsRead,
    markAllAsRead,
  };
}
