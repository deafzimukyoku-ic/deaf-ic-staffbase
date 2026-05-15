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

export default function InviteAcceptPage() {
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
      // 1. URLフラグメントから access_token を抽出（Supabase implicit flow）
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
            // フラグメントをURLから除去（トークン露出防止）
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

      // 3. 既存セッションがあるか確認（直接アクセスの場合）
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setAuthenticated(true);
        setChecking(false);
        return;
      }

      // いずれもなければエラー
      setError('招待リンクが無効または期限切れです。管理者に再招待を依頼してください。');
      setChecking(false);
    }

    handleAuth();
  }, [supabase]);

  /* リアルタイム判定: 確認欄に入力があれば一致/不一致を即時表示。
     送信ボタンも一致しないと押せない。 */
  const matchStatus: 'empty' | 'match' | 'mismatch' =
    confirmPassword.length === 0 ? 'empty'
    : password === confirmPassword ? 'match'
    : 'mismatch';
  const lengthOK = password.length >= 8;
  const canSubmit = lengthOK && matchStatus === 'match' && !loading;

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
      toast.error('パスワード設定に失敗しました', { description: updateErr.message });
      setLoading(false);
      return;
    }

    toast.success('パスワードを設定しました。ログインしてください。');

    // ログアウトして改めてログインさせる（セッションをクリーンにする）
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
              招待リンクは送信から約1時間で失効します。期限切れの場合は管理者に再招待を依頼してください。
            </p>
            <Button className="w-full" onClick={() => router.push('/login')}>
              ログインページへ
            </Button>
          </CardContent>
        </Card>
      </div>
    );
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
          <CardDescription>職員ステーション — 初回パスワード設定</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-diletto-blue/30 bg-blue-50 p-3 mb-4 text-sm leading-relaxed">
            💡 <strong>ご自身でパスワードを決めてください。</strong><br />
            お好きな文字列を <strong>8文字以上</strong> で入力 → <strong>同じパスワードをもう一度</strong> 入力して「決定する」を押してください。
          </div>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">あなたが決めるパスワード（8文字以上）</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="8文字以上で自由に決めて入力"
                className={password.length > 0 && !lengthOK ? 'border-amber-400 focus-visible:ring-amber-400' : ''}
                autoComplete="new-password"
              />
              {password.length > 0 && !lengthOK && (
                <p className="text-xs text-amber-700" aria-live="polite">
                  あと <strong>{8 - password.length}</strong> 文字必要です
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">もう一度同じパスワードを入力（確認）</Label>
              <Input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="上で入力したのと同じパスワード"
                className={
                  matchStatus === 'match' ? 'border-emerald-500 focus-visible:ring-emerald-500'
                  : matchStatus === 'mismatch' ? 'border-red-500 focus-visible:ring-red-500'
                  : ''
                }
                autoComplete="new-password"
              />
              {matchStatus === 'match' && (
                <p className="text-xs text-emerald-700 font-bold" aria-live="polite">
                  ✅ 一致しています
                </p>
              )}
              {matchStatus === 'mismatch' && (
                <p className="text-xs text-red-600 font-bold" aria-live="polite">
                  ⚠ 入力内容が一致しません。もう一度確認してください
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {loading ? '設定中...' : 'このパスワードに決定する'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
