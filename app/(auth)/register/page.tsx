'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { AuthHeroPanel } from '@/components/auth/AuthHeroPanel';

/* ─── 新規登録ページ ─── */
export default function RegisterPage() {
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // サーバーサイドAPIで登録処理（service_roleでRLSバイパス）
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, email, password }),
    });

    const result = await res.json();

    if (!res.ok) {
      toast.error('登録に失敗しました', { description: result.error });
      setLoading(false);
      return;
    }

    // サーバーでAuthユーザーが作成済みなので、クライアント側でサインインしてセッション確立
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      toast.error('ログインに失敗しました', { description: signInError.message });
      setLoading(false);
      return;
    }

    toast.success('登録が完了しました');
    router.refresh();
    await new Promise((resolve) => setTimeout(resolve, 500));
    router.push('/setup');
  }

  return (
    <div className="flex min-h-screen flex-col bg-diletto-beige">
      {/* ── スプリットレイアウト ── */}
      <div className="auth-split-layout" style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        flex: 1,
      }}>
        {/* 左: 紹介パネル */}
        <AuthHeroPanel />

        {/* 右: 新規登録フォーム */}
        <div className="auth-form-panel" style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 48px',
          maxWidth: 560,
          margin: '0 auto',
          width: '100%',
          minHeight: '100vh',
        }}>
          <h2 style={{
            fontSize: '1.8rem',
            fontWeight: 800,
            color: '#111',
            marginBottom: 8,
            letterSpacing: '0.02em',
          }}>
            無料で始める
          </h2>
          <p style={{
            fontSize: '0.9rem',
            color: '#888',
            marginBottom: 32,
          }}>
            30秒で登録完了。すぐに使い始められます。
          </p>

          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="company" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#333' }}>会社名・法人名</Label>
              <Input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                placeholder="株式会社〇〇"
                style={{ padding: '12px 16px', fontSize: '0.95rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="email" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#333' }}>メールアドレス</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@example.com"
                style={{ padding: '12px 16px', fontSize: '0.95rem' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label htmlFor="password" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#333' }}>パスワード</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="8文字以上"
                style={{ padding: '12px 16px', fontSize: '0.95rem' }}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              style={{
                padding: '14px 0',
                fontSize: '0.95rem',
                fontWeight: 700,
                marginTop: 8,
              }}
            >
              {loading ? '登録中...' : '無料で登録する →'}
            </Button>
          </form>

          <p style={{
            marginTop: 16,
            fontSize: '0.78rem',
            color: '#aaa',
            textAlign: 'center',
            lineHeight: 1.6,
          }}>
            登録すると無料トライアルが自動で適用されます。
          </p>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: '0.85rem', color: '#888' }}>
            <p>
              すでにアカウントをお持ちの方は{' '}
              <Link href="/login" className="text-diletto-blue hover:underline" style={{ fontWeight: 600 }}>
                ログイン
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* レスポンシブ: モバイルでは1カラムに */}
      <style>{`
        @media (max-width: 900px) {
          .auth-split-layout {
            grid-template-columns: 1fr !important;
          }
          .auth-form-panel {
            padding: 40px 24px !important;
          }
        }
      `}</style>
    </div>
  );
}
