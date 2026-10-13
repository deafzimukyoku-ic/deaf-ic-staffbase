import { createBrowserClient } from '@supabase/ssr';
import type { AuthChangeEvent, SupabaseClient, UserResponse } from '@supabase/supabase-js';
import { withDevNameMask, IS_DEV_MASK_ENABLED } from './dev-name-mask';

export function createClient() {
  /* 招待 / パスワード再設定リンク (admin.generateLink) は implicit grant の
     #access_token ハッシュで着地するが、@supabase/ssr は flowType を 'pkce' に
     固定する。SDK の URL 自動検出 (detectSessionInUrl) を有効のままにすると
     _getSessionFromURL が flowType 不一致で例外を投げてセッション確立に失敗し、
     ページ側の手動 setSession と競合して "Auth session missing!" が間欠発生する。
     callback ページ (invite/accept, reset-password/confirm) が URL を自前で解析して
     setSession / exchangeCodeForSession を呼ぶため、自動検出は無効化する。
     flowType は上書き不可のため detectSessionInUrl 無効化が取り得る最小修正。
     詳細: docs/error-log.md */
  const authOptions = { auth: { detectSessionInUrl: false } };
  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    IS_DEV_MASK_ENABLED
      ? { ...authOptions, global: { fetch: withDevNameMask(fetch.bind(globalThis)) } }
      : authOptions,
  );
  shareGetUser(client.auth);
  return client;
}

type AuthClient = SupabaseClient['auth'];

/* getUser() の結果をこの時間だけ使い回す。ログイン状態の変化（ログイン・ログアウト・
   トークン更新・ユーザー更新）では即座に捨てるので、古い結果が残るのは「サーバー側だけで
   ユーザーが消された」場合に限られる。その場合もデータは RLS で守られ、middleware が弾く */
const GET_USER_SHARE_MS = 5 * 60_000;
const sharedAuths = new WeakSet<AuthClient>();

/**
 * getUser() は呼ぶたびに Auth サーバーへ問い合わせる。レイアウト・通知ベル・ページ本体が
 * それぞれ呼ぶため、1 画面を開くたびに 4 回が順番に走り約 0.8 秒待っていた（2026-10-13 本番実測）。
 * ブラウザのクライアントはシングルトンなので、ここで 1 回分の結果を全呼び出し元で共有する。
 * 呼び出し側（57 ファイル）は書き換えずに済む。
 */
function shareGetUser(auth: AuthClient) {
  /* サーバー描画中はクライアントが毎回作り直されて共有の意味が無く、購読だけが溜まるので何もしない */
  if (typeof window === 'undefined') return;
  if (sharedAuths.has(auth)) return;
  sharedAuths.add(auth);

  const original = auth.getUser.bind(auth);
  let shared: { promise: Promise<UserResponse>; at: number } | null = null;

  auth.getUser = (jwt?: string) => {
    /* 明示の JWT 指定は別ユーザーの検証なので共有しない */
    if (jwt) return original(jwt);
    if (shared && Date.now() - shared.at < GET_USER_SHARE_MS) return shared.promise;
    const promise = original().then(
      (res: UserResponse) => {
        /* 失敗（未ログイン・通信エラー）は共有しない。次の呼び出しで取り直す */
        if (res.error || !res.data.user) shared = null;
        return res;
      },
      (err: unknown) => {
        shared = null;
        throw err;
      },
    );
    shared = { promise, at: Date.now() };
    return promise;
  };

  /* コールバック内で Supabase を await するとデッドロックするため、参照を捨てるだけにする */
  auth.onAuthStateChange((event: AuthChangeEvent) => {
    if (event !== 'INITIAL_SESSION') shared = null;
  });
}
