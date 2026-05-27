'use client';
import { useEffect, useRef, useState } from 'react';

/* 短期 Signed URL を都度発行する内製 hook。
   - 同一 path はモジュールキャッシュで dedupe (失効まで 60 秒残してたら再利用)
   - コンポーネント unmount 後に setState しない (mountedRef ガード)
   - swr 未導入のため内製。10 行程度の状態管理で十分

   退職者は /api/storage/sign が 403 を返すため、自動的に再生不可になる。 */

interface SignedUrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

interface CachedEntry {
  url: string;
  expiresAt: number; // ms epoch
  inflight?: Promise<{ url: string; expiresAt: number }>;
}

const cache = new Map<string, CachedEntry>();

const RENEWAL_MARGIN_MS = 60_000; // 失効まで 60 秒切ったら再フェッチ

async function fetchSignedUrl(path: string): Promise<{ url: string; expiresAt: number }> {
  const res = await fetch('/api/storage/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  const j: { signed_url: string; expires_at: string } = await res.json();
  return { url: j.signed_url, expiresAt: new Date(j.expires_at).getTime() };
}

export function useSignedMediaUrl(storagePath: string | null | undefined): SignedUrlState {
  const [state, setState] = useState<SignedUrlState>(() => ({
    url: storagePath ? cache.get(storagePath)?.url ?? null : null,
    loading: !!storagePath,
    error: null,
  }));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!storagePath) {
      setState({ url: null, loading: false, error: null });
      return;
    }

    const now = Date.now();
    const cached = cache.get(storagePath);
    if (cached && cached.expiresAt - now > RENEWAL_MARGIN_MS) {
      setState({ url: cached.url, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    /* 同じ path に対する同時 fetch を dedupe する。inflight があれば乗っかる */
    const existing = cache.get(storagePath);
    const promise = existing?.inflight ?? fetchSignedUrl(storagePath);
    if (!existing?.inflight) {
      cache.set(storagePath, {
        url: existing?.url ?? '',
        expiresAt: existing?.expiresAt ?? 0,
        inflight: promise,
      });
    }

    promise
      .then(({ url, expiresAt }) => {
        cache.set(storagePath, { url, expiresAt });
        if (mountedRef.current) {
          setState({ url, loading: false, error: null });
        }
      })
      .catch((e: Error) => {
        cache.delete(storagePath);
        if (mountedRef.current) {
          setState({ url: null, loading: false, error: e.message });
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [storagePath]);

  return state;
}
