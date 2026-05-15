import { createBrowserClient } from '@supabase/ssr';
import { withDevNameMask, IS_DEV_MASK_ENABLED } from './dev-name-mask';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    IS_DEV_MASK_ENABLED
      ? { global: { fetch: withDevNameMask(fetch.bind(globalThis)) } }
      : undefined,
  );
}
