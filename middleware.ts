import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // DEV: ログイン検証スキップ（ローカル確認用）
  // .env.local に DEV_SKIP_AUTH=1 を設定すると全ルートが素通し。
  // 本番環境（NODE_ENV=production）では絶対に有効化させない。
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_SKIP_AUTH === '1') {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims(): 非対称鍵(ES256)で JWT をローカル検証し、必要ならトークンをリフレッシュする
  // （Supabase SSR の正準パターン）。getUser() の Auth サーバーへのネットワーク往復
  // (~300-500ms/req) を排除して全ナビゲーションを高速化する。
  // 注意: createServerClient と getClaims() の間にコードを挟まない（挟むとランダムログアウトの原因）。
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const userId = claims?.sub ?? null;

  const pathname = request.nextUrl.pathname;

  const publicPaths = ['/login', '/register', '/reset-password', '/invite', '/auth/callback'];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  if (!claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // /invite/accept と /reset-password/confirm は code 交換で「認証済み」扱いになるが、
  // パスワード設定 UI を表示する必要があるため auto-redirect から除外する。
  if (
    claims &&
    isPublic &&
    !pathname.startsWith('/invite') &&
    !pathname.startsWith('/reset-password/confirm')
  ) {
    const { data: employee } = await supabase
      .from('employees')
      .select('role, status')
      .eq('auth_user_id', userId)
      .maybeSingle();

    /* 退職者は admin が誤って /login を踏ませても入れない（API/Auth BAN と二重に防ぐ）。
       既存セッションがあっても retired ならここで signOut + ?error=retired で通知。 */
    if (employee?.status === 'retired') {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '?error=retired';
      return NextResponse.redirect(url);
    }

    if (employee) {
      const url = request.nextUrl.clone();
      if (employee.role === 'admin') {
        url.pathname = '/admin/dashboard';
      } else if (employee.role === 'manager') {
        url.pathname = '/mgr/dashboard';
      } else if (employee.role === 'shift_manager') {
        url.pathname = '/admin/shifts/dashboard';
      } else {
        url.pathname = '/my/dashboard';
      }
      return NextResponse.redirect(url);
    }
  }

  if (claims && (pathname.startsWith('/admin') || pathname.startsWith('/setup') || pathname.startsWith('/mgr') || pathname.startsWith('/my'))) {
    const { data: employee } = await supabase
      .from('employees')
      .select('role, status')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (!employee) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }

    /* 退職者は保護ルートに入れない。Auth BAN が効いていれば session refresh で蹴られるが、
       既存 access token が生きている短時間でもアクセスさせないための保険。 */
    if (employee.status === 'retired') {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '?error=retired';
      return NextResponse.redirect(url);
    }

    /* shift_manager: 事業所共用のシフト・送迎専用アカウント (migration 140)。
       許可: /admin/shifts/*, /admin/children, /admin/requests のみ。
       それ以外は /admin/shifts/dashboard にリダイレクト。 */
    if (employee.role === 'shift_manager') {
      const allowed =
        pathname.startsWith('/admin/shifts') ||
        pathname.startsWith('/admin/children') ||
        pathname.startsWith('/admin/requests');
      if (!allowed) {
        const url = request.nextUrl.clone();
        url.pathname = '/admin/shifts/dashboard';
        return NextResponse.redirect(url);
      }
      return supabaseResponse;
    }

    if ((pathname.startsWith('/admin') || pathname.startsWith('/setup')) && employee.role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = employee.role === 'manager' ? '/mgr/dashboard' : '/my/dashboard';
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith('/mgr') && employee.role !== 'manager' && employee.role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/my/dashboard';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /* /public 以下の静的ファイル（logo.jpg / favicon / 画像 / フォント等）と _next / api を
       middleware の対象から外す。これらは認証チェック不要で、未ログインでも配信される必要がある
       （ログイン画面のロゴ等）。
       webmanifest は PWA 起動時 (未ログイン状態でも) ブラウザが取得するので除外に追加。 */
    '/((?!_next/static|_next/image|api/|.*\\.(?:jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|otf|css|js|map|webmanifest)$).*)',
  ],
};
