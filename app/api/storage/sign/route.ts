import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/* 短期 Signed URL 発行 API。
   退職者ブロックを (1) RPC can_access_media_path (active + tenant 一致判定)
   (2) RLS (migration 210) の二重ガードで担保。

   呼出形式: POST /api/storage/sign  body: { "path": "manuals/<tenant>/abc.mp4" }
   返却:    { "signed_url": string, "expires_at": ISO8601 }
   失敗時: 401 (未認証) / 403 (退職者・別テナント) / 400 (path 不正) / 500 (発行失敗)

   TTL: 動画 60 分 / PDF・画像 10 分。再生中 expire を防ぐため動画は長め。 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const path = (body as { path?: unknown })?.path;
  if (typeof path !== 'string' || !path || path.length > 500) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }
  if (path.includes('..') || path.startsWith('/')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: canAccess, error: rpcErr } = await supabase.rpc('can_access_media_path', {
    p_path: path,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  if (canAccess !== true) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const ext = path.split('.').pop()?.toLowerCase() || '';
  const isVideo = VIDEO_EXTENSIONS.has(ext);
  const expiresInSeconds = isVideo ? 60 * 60 : 60 * 10;

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: signed, error: signErr } = await admin.storage
    .from('documents')
    .createSignedUrl(path, expiresInSeconds);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message || 'failed to create signed url' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      signed_url: signed.signedUrl,
      expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
