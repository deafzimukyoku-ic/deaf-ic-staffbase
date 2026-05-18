'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password/confirm`,
    });

    if (error) {
      toast.error('送信に失敗しました', { description: error.message });
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-beige px-4">
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
          <CardDescription>職員ステーション — パスワードリセット</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                リセット用のメールを送信しました。メール内のリンクからパスワードを再設定してください。
              </p>
              <p className="text-xs text-muted-foreground">
                ※ リンクは送信から約1時間で失効します。期限切れの場合は再度ご依頼ください。
              </p>
              <Link href="/login">
                <Button variant="outline" className="w-full">ログインに戻る</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">登録メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="admin@example.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? '送信中...' : 'リセットメールを送信'}
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="text-brand-blue hover:underline">
                  ログインに戻る
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
