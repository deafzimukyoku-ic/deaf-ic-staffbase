'use client';
import { useEffect, useRef, useState } from 'react';

/* 短期 Signed URL を都度発行する内製 hook。
   - 同一 path はモジュールキャッシュで dedupe (失効まで 60 秒残してたら再利用)
   - コンポーネント unmount 後に setState しない (mountedRef ガード)
   - swr 未導入のため内製。10 行程度の状態管理で十分

   バケットは path で自動判定:
     - 'videos/...' → videos バケット (migration 213, file_size_limit 500 MB)
     - それ以外      → documents バケット (migration 207/210/212, file_size_limit 200 MB)

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

/* cache key は `${bucket}:${path}`。bucket は path 先頭から導出するため
   将来同名 path が複数バケットに存在した場合も衝突しない。 */
const cache = new Map<string, CachedEntry>();

const RENEWAL_MARGIN_MS = 60_000; // 失効まで 60 秒切ったら再フェッチ

function bucketFromPath(path: string): 'videos' | 'documents' {
  return path.startsWith('videos/') ? 'videos' : 'documents';
}

async function fetchSignedUrl(path: string): Promise<{ url: string; expiresAt: number }> {
  const bucket = bucketFromPath(path);
  const res = await fetch('/api/storage/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, path }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  const j: { signed_url: string; expires_at: string } = await res.json();
  return { url: j.signed_url, expiresAt: new Date(j.expires_at).getTime() };
}

export function useSignedMediaUrl(storagePath: string | null | undefined): SignedUrlState {
  const cacheKey = storagePath ? `${bucketFromPath(storagePath)}:${storagePath}` : null;
  const [state, setState] = useState<SignedUrlState>(() => ({
    url: cacheKey ? cache.get(cacheKey)?.url ?? null : null,
    loading: !!storagePath,
    error: null,
  }));
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!storagePath || !cacheKey) {
      setState({ url: null, loading: false, error: null });
      return;
    }

    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt - now > RENEWAL_MARGIN_MS) {
      setState({ url: cached.url, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    /* 同じ path に対する同時 fetch を dedupe する。inflight があれば乗っかる */
    const existing = cache.get(cacheKey);
    const promise = existing?.inflight ?? fetchSignedUrl(storagePath);
    if (!existing?.inflight) {
      cache.set(cacheKey, {
        url: existing?.url ?? '',
        expiresAt: existing?.expiresAt ?? 0,
        inflight: promise,
      });
    }

    promise
      .then(({ url, expiresAt }) => {
        cache.set(cacheKey, { url, expiresAt });
        if (mountedRef.current) {
          setState({ url, loading: false, error: null });
        }
      })
      .catch((e: Error) => {
        cache.delete(cacheKey);
        if (mountedRef.current) {
          setState({ url: null, loading: false, error: e.message });
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [storagePath, cacheKey]);

  return state;
}
