import { NextRequest } from 'next/server';

/**
 * Google Drive 動画ストリーミングプロキシ
 *
 * Drive の `uc?export=download&id=...` は cross-origin で `<video>` の src に直接
 * 渡すと、ウイルススキャン警告ページ (HTML) や redirect chain で失敗する。
 * ここで server-side fetch して video/mp4 として streaming で返すことで、
 * クライアントはネイティブ `<video>` でシークも再生もできるようにする。
 *
 * 前提: Drive ファイルが「リンクを知っている全員」共有設定。
 * 認証付き private ファイルは別途 Drive API + OAuth が必要 (現状未対応)。
 *
 * Range header をフォワードして seek 対応。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  // fileId は英数字 + - + _ のみ 20〜60 文字 を許可 (Drive の ID 形式)
  if (!/^[\w-]{20,60}$/.test(fileId)) {
    return new Response('Invalid file ID', { status: 400 });
  }

  const range = req.headers.get('range');
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; deaf-ic video proxy)',
  };
  if (range) fetchHeaders['Range'] = range;

  // 新しい Drive URL: usercontent ドメイン経由 + confirm=t でスキャン警告を skip
  const primaryUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;

  let upstream: Response;
  try {
    upstream = await fetch(primaryUrl, { headers: fetchHeaders, redirect: 'follow' });
  } catch (e) {
    return new Response(`Upstream fetch failed: ${(e as Error).message}`, { status: 502 });
  }

  const upstreamContentType = upstream.headers.get('content-type') || '';

  // HTML が返ってきたら "アクセス権限なし" or "認証必要" → 403 に変換
  if (upstreamContentType.includes('text/html')) {
    return new Response(
      'Drive video not accessible. ファイルの共有設定を「リンクを知っている全員」にしてください。',
      { status: 403 },
    );
  }

  // streaming で client に返す。Content-Length / Content-Range はそのまま透過
  const headers: HeadersInit = {
    'Content-Type': upstreamContentType || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
  };
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) (headers as Record<string, string>)['Content-Length'] = contentLength;
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) (headers as Record<string, string>)['Content-Range'] = contentRange;

  return new Response(upstream.body, { status: upstream.status, headers });
}
