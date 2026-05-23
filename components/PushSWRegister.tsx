'use client';

import { useEffect } from 'react';

/*
 * Service Worker (public/sw.js) をクライアント側で登録する。
 * - サポート外ブラウザ (navigator.serviceWorker 未定義) は silent skip
 * - localhost と HTTPS でのみ動作 (Service Worker 要件)
 * - app/layout.tsx で 1 度 mount する
 */
export function PushSWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const tryRegister = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        /* 登録失敗してもアプリは動かす (Push が出ないだけ) */
      }
    };

    /* ページ load 後に登録 (初回描画と競合させない) */
    if (document.readyState === 'complete') {
      tryRegister();
    } else {
      window.addEventListener('load', tryRegister, { once: true });
    }
  }, []);

  return null;
}
