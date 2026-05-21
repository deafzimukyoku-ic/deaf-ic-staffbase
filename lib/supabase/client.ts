import { createBrowserClient } from '@supabase/ssr';
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
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    IS_DEV_MASK_ENABLED
      ? { ...authOptions, global: { fetch: withDevNameMask(fetch.bind(globalThis)) } }
      : authOptions,
  );
}
