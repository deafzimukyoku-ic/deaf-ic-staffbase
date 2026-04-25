import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Supabase Auth Callback Handler (PKCE方式)
 *
 * Supabaseがメール内リンクから送る認証コードを受け取り、
 * セッションに交換してリダイレクトする。
 *
 * 用途:
 * - 社員招待のrecovery link → /invite/accept へリダイレクト
 * - パスワードリセット → /login へリダイレクト
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/invite/accept';

  if (!code) {
    // codeがない場合はエラー
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'missing_code');
    return NextResponse.redirect(url);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // コード交換失敗（期限切れなど）
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'invalid_code');
    return NextResponse.redirect(url);
  }

  // セッション確立成功 → リダイレクト先へ
  const url = request.nextUrl.clone();
  url.pathname = next;
  url.searchParams.delete('code');
  url.searchParams.delete('next');
  return NextResponse.redirect(url);
}
