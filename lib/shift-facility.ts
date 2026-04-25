'use client';

/**
 * シフトモード共通の facility 選択状態。
 * - localStorage に永続化
 * - window CustomEvent でモード横断ページに通知
 * - manager は 1 facility のみなので実質無効
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'shift-facility-id';
const EVENT = 'shift-facility-changed';

export function getStoredFacilityId(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setStoredFacilityId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* noop */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
  }
}

export function useShiftFacilityId(): [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(getStoredFacilityId());
    function onChange(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      setId(detail);
    }
    window.addEventListener(EVENT, onChange as EventListener);
    return () => window.removeEventListener(EVENT, onChange as EventListener);
  }, []);
  // セッターは stable ref（useCallback）。useEffect の依存配列に入れても無限ループにならない
  const setter = useCallback((next: string) => {
    setStoredFacilityId(next);
    setId(next);
  }, []);
  return [id, setter];
}
