import { NextResponse } from 'next/server';

/* VAPID 公開鍵をクライアントに渡すための GET。
   NEXT_PUBLIC_VAPID_PUBLIC_KEY は本来 client が直接読めるが、SW 内では import.meta.env が
   使えないため API 経由で配布する。
   未設定なら 503 を返してクライアント側で「ブラウザは対応しているが鍵未設定」を判別する。 */
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
  if (!publicKey) {
    return NextResponse.json({ error: 'VAPID 公開鍵が未設定です' }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
