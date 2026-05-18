'use client';

interface Props {
  title: string;
  youtubeUrl: string | null;
  pdfUrl: string | null;
}

// YouTube ID 抽出（多形式対応 + Google 検索結果 vid: 形式）
function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
    /[,&?#]vid:([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  const fallback = url.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|[,&?#]vid:)([\w-]{5,})/);
  return fallback ? fallback[1] : null;
}

// content_blocks がない旧来形式の研修用プレイヤー。
// BlockRenderer の動画ブロックと同じ表示戦略（min() で幅・高さ制約）に統一。
export function TrainingPlayer({ title, youtubeUrl, pdfUrl }: Props) {
  const ytId = youtubeUrl ? extractYoutubeId(youtubeUrl) : null;
  const embedUrl = ytId ? `https://www.youtube.com/embed/${ytId}` : null;

  return (
    <div className="space-y-4">
      {embedUrl ? (
        <div
          className="mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-black block"
          style={{
            aspectRatio: '16 / 9',
            width: 'min(100%, calc(65vh * 16 / 9))',
          }}
        >
          <iframe
            src={embedUrl}
            className="w-full h-full block"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={title}
          />
        </div>
      ) : ytId && youtubeUrl ? (
        // ID は取れたが embed 不可のケース: YouTube サムネイル + 再生ボタン
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noreferrer"
          className="mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-black block relative group"
          style={{
            aspectRatio: '16 / 9',
            width: 'min(100%, calc(65vh * 16 / 9))',
          }}
          title="YouTube で再生"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`}
            alt={`${title} のサムネイル`}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
            <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </a>
      ) : null}

      {pdfUrl && (
        <div className="border rounded-md p-4 text-center">
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-blue hover:underline text-sm"
          >
            📁 PDFスライドを開く
          </a>
        </div>
      )}
      {!embedUrl && !ytId && !pdfUrl && (
        <p className="text-sm text-brand-gray-light text-center py-4">教材が未登録です</p>
      )}
    </div>
  );
}
