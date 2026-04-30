'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
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

  /* /auth/callback から code 不正等で蹴られた時のエラー表示。
     URL クエリは即削除してリロード時の再表示を防ぐ。 */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (!err) return;
    const messages: Record<string, string> = {
      missing_code: '認証コードが見つかりませんでした',
      invalid_code: '認証リンクが無効または期限切れです',
    };
    toast.error(messages[err] || '認証に失敗しました', {
      description: 'お手数ですが、もう一度ログインまたは招待メールの再送をご依頼ください。',
    });
    params.delete('error');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

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
    } else if (employee.role === 'shift_manager') {
      /* シフト統括: 事業所共用 / migration 140 */
      router.push('/admin/shifts/dashboard');
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
          {/* NPO ロゴ + 法人名（モバイル含めて常時表示）*/}
          <div className="auth-form-brand" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            marginBottom: 32,
            paddingBottom: 28,
            borderBottom: '1px solid rgba(0,0,0,0.08)',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="認定NPO法人 名古屋ろう国際センター"
              style={{ height: 96, width: 'auto', objectFit: 'contain' }}
            />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#111', letterSpacing: '0.02em', marginBottom: 4 }}>
                認定NPO法人 名古屋ろう国際センター
              </div>
              <div style={{ fontSize: '0.85rem', color: '#666', letterSpacing: '0.04em' }}>
                職員ステーション
              </div>
            </div>
          </div>

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
            職員ステーションにログイン
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
            <p>
              <Link href="/reset-password" className="text-diletto-blue hover:underline">
                パスワードを忘れた方
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
