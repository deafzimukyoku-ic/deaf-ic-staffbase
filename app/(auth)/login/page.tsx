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

/* ─── ログインページ ─── */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error('ログインに失敗しました', { description: error.message });
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('ログインに失敗しました');
      setLoading(false);
      return;
    }

    const { data: employee } = await supabase
      .from('employees')
      .select('role')
      .eq('auth_user_id', user.id)
      .single();

    if (!employee) {
      toast.error('社員情報が見つかりません', {
        description: 'アカウントに紐づく社員情報がありません。管理者にお問い合わせください。',
      });
      setLoading(false);
      return;
    }

    if (employee.role === 'admin') {
      router.push('/admin/dashboard');
    } else if (employee.role === 'manager') {
      router.push('/mgr/dashboard');
    } else {
      router.push('/my/dashboard');
    }

    router.refresh();
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

        {/* 右: ログインフォーム */}
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
            ログイン
          </h2>
          <p style={{
            fontSize: '0.9rem',
            color: '#888',
            marginBottom: 32,
          }}>
            staff<span style={{ color: '#1a3eb8', fontWeight: 700 }}>base</span> アカウントにログイン
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
                placeholder="••••••••"
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
              {loading ? 'ログイン中...' : 'ログイン →'}
            </Button>
          </form>

          <div style={{ marginTop: 24, textAlign: 'center', fontSize: '0.85rem', color: '#888' }}>
            <p style={{ marginBottom: 8 }}>
              <Link href="/reset-password" className="text-diletto-blue hover:underline">
                パスワードを忘れた方
              </Link>
            </p>
            <p>
              すでにアカウントをお持ちでない方は{' '}
              <Link href="/register" className="text-diletto-blue hover:underline" style={{ fontWeight: 600 }}>
                新規登録
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
