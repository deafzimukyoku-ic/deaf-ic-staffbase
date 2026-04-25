import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // DEV: ログイン検証スキップ（ローカル確認用）
  // .env.local に DEV_SKIP_AUTH=1 を設定すると全ルートが素通し
  if (process.env.DEV_SKIP_AUTH === '1') {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const publicPaths = ['/login', '/register', '/reset-password', '/invite', '/auth/callback'];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isPublic && !pathname.startsWith('/invite')) {
    const { data: employee } = await supabase
      .from('employees')
      .select('role')
      .eq('auth_user_id', user.id)
      .single();

    if (employee) {
      const url = request.nextUrl.clone();
      if (employee.role === 'admin') {
        url.pathname = '/admin/dashboard';
      } else if (employee.role === 'manager') {
        url.pathname = '/mgr/dashboard';
      } else {
        url.pathname = '/my/dashboard';
      }
      return NextResponse.redirect(url);
    }
  }

  if (user && (pathname.startsWith('/admin') || pathname.startsWith('/setup') || pathname.startsWith('/mgr') || pathname.startsWith('/my'))) {
    const { data: employee } = await supabase
      .from('employees')
      .select('role')
      .eq('auth_user_id', user.id)
      .single();

    if (!employee) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
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
    '/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|icon\\.svg|api/).*)',
  ],
};
