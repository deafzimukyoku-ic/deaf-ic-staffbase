import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { withDevNameMask, IS_DEV_MASK_ENABLED } from './dev-name-mask';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component では set できないケースがある（読み取り専用）
          }
        },
      },
      ...(IS_DEV_MASK_ENABLED
        ? { global: { fetch: withDevNameMask(fetch.bind(globalThis)) } }
        : {}),
    },
  );
}
