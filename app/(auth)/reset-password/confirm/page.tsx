'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';

/**
 * パスワードリセット完了ページ
 *
 * /reset-password でメール送信 → メール内リンクが Supabase verify を経由して
 * このページに `?code=...` (PKCE) もしくは `#access_token=...` (implicit) で到達する。
 * セッションを確立した後、新パスワードを設定する。
 */
export default function ResetPasswordConfirmPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function handleAuth() {
      // 1. URLフラグメントから access_token を抽出（implicit flow）
      const hash = window.location.hash;
      if (hash && hash.includes('access_token')) {
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          const { error: sessionErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!sessionErr) {
            window.history.replaceState(null, '', window.location.pathname);
            setAuthenticated(true);
            setChecking(false);
            return;
          }
        }
      }

      // 2. URLクエリパラメータから code を抽出（PKCE flow）
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      if (code) {
        const { error: codeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (!codeErr) {
          window.history.replaceState(null, '', window.location.pathname);
          setAuthenticated(true);
          setChecking(false);
          return;
        }
      }

      // 3. 既存セッションがあるか確認（他経路で来た場合）
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setAuthenticated(true);
        setChecking(false);
        return;
      }

      // いずれもなければエラー
      setError('リセットリンクが無効または期限切れです。再度パスワードリセットを依頼してください。');
      setChecking(false);
    }

    handleAuth();
  }, [supabase]);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('パスワードが一致しません');
      return;
    }

    if (password.length < 8) {
      toast.error('パスワードは8文字以上で入力してください');
      return;
    }

    setLoading(true);

    const { error: updateErr } = await supabase.auth.updateUser({ password });

    if (updateErr) {
      toast.error('パスワード再設定に失敗しました', { description: updateErr.message });
      setLoading(false);
      return;
    }

    toast.success('新しいパスワードを設定しました。ログインしてください。');

    // ログアウトして改めてログインさせる
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-diletto-beige px-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" />
          <span className="text-sm text-diletto-gray">認証を確認中...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-diletto-beige px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="認定NPO法人 名古屋ろう国際センター"
              style={{ height: 80, width: 'auto', objectFit: 'contain', margin: '0 auto 12px' }}
            />
            <CardTitle className="text-base font-bold tracking-tight">
              認定NPO法人 名古屋ろう国際センター
            </CardTitle>
            <CardDescription className="text-diletto-red">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-4">
              リセットリンクは送信から約1時間で失効します。期限切れの場合は再度パスワードリセットを依頼してください。
            </p>
            <div className="flex flex-col gap-2">
              <Button className="w-full" onClick={() => router.push('/reset-password')}>
                パスワードリセットを再依頼
              </Button>
              <Button variant="outline" className="w-full" onClick={() => router.push('/login')}>
                ログインページへ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-diletto-beige px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="認定NPO法人 名古屋ろう国際センター"
            style={{ height: 80, width: 'auto', objectFit: 'contain', margin: '0 auto 12px' }}
          />
          <CardTitle className="text-base font-bold tracking-tight">
            認定NPO法人 名古屋ろう国際センター
          </CardTitle>
          <CardDescription>職員ステーション — 新しいパスワードを設定</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">新しいパスワード</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="8文字以上"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">パスワード確認</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="もう一度入力"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '設定中...' : 'パスワードを変更'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
