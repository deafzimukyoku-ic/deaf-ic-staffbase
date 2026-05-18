'use client';

import type { ContentBlock } from './BlockEditor';

// YouTube 動画ID を様々な URL 形式から抽出
// 対応: watch?v= / youtu.be / /embed/ / /shorts/ / /live/ / m.youtube.com
// Google 検索結果の動画タブ (google.com/search?...vid:XXX) も対応
function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /[?&]v=([\w-]{11})/,             // youtube.com/watch?v=ID
    /youtu\.be\/([\w-]{11})/,        // youtu.be/ID
    /\/embed\/([\w-]{11})/,          // youtube.com/embed/ID
    /\/shorts\/([\w-]{11})/,         // youtube.com/shorts/ID
    /\/live\/([\w-]{11})/,           // youtube.com/live/ID
    /[,&?#]vid:([\w-]{11})/,         // google.com/search?...vid:ID,st:0 等
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  // ID が 11 文字でない古い動画への保険（5+ 文字）
  const fallback = url.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|[,&?#]vid:)([\w-]{5,})/);
  return fallback ? fallback[1] : null;
}

function youtubeEmbedUrl(url: string): string | null {
  const id = extractYoutubeId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function youtubeThumbnailUrl(url: string): string | null {
  const id = extractYoutubeId(url);
  // hqdefault は全動画で必ず存在する（maxres は無い動画もある）
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

function googleDriveEmbedUrl(url: string): string | null {
  const match = url.match(/\/file\/d\/([\w-]+)/);
  if (match) return `https://drive.google.com/file/d/${match[1]}/preview`;
  return null;
}

// blocks が空かつ fallbackText がある場合、fallback を単一 text ブロックとして扱う
export function BlockRenderer({ blocks, fallbackText }: { blocks: ContentBlock[] | null | undefined; fallbackText?: string | null }) {
  const list: ContentBlock[] = (blocks && blocks.length > 0)
    ? blocks
    : fallbackText
      ? [{ type: 'text', value: fallbackText }]
      : [];

  if (list.length === 0) return null;

  return (
    <div className="space-y-4">
      {list.map((block, i) => {
        if (block.type === 'text') {
          return (
            <p key={i} className="text-sm text-brand-ink/90 whitespace-pre-wrap leading-relaxed">
              {block.value}
            </p>
          );
        }

        if (block.type === 'image') {
          // 画像: 縦の見切れ防止に max-h を設定。クリックで原寸を別タブ表示
          return (
            <figure key={i} className="space-y-1">
              <a href={block.url} target="_blank" rel="noreferrer" className="block" title="クリックで原寸表示">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={block.url}
                  alt={block.caption || ''}
                  className="max-w-full max-h-[65vh] mx-auto rounded-md border border-brand-gray/10 object-contain cursor-zoom-in"
                />
              </a>
              {block.caption && (
                <figcaption className="text-xs text-brand-gray-light text-center">
                  {block.caption}
                </figcaption>
              )}
            </figure>
          );
        }

        if (block.type === 'video') {
          // block.source は信用せず URL から判定する（過去のデータで source が誤設定の可能性）
          const url = block.url || '';
          const ytId = extractYoutubeId(url);
          const driveEmbed = googleDriveEmbedUrl(url);
          const isYoutubeUrl = /(?:youtube\.com|youtu\.be)/i.test(url);

          // 1. YouTube ID が取れた → 埋め込み iframe
          if (ytId) {
            return (
              <div key={i}
                className="mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-black block"
                style={{
                  aspectRatio: '16 / 9',
                  width: 'min(100%, calc(65vh * 16 / 9))',
                }}
              >
                <iframe
                  src={`https://www.youtube.com/embed/${ytId}`}
                  className="w-full h-full block"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="動画"
                />
              </div>
            );
          }

          // 2. Google Drive URL → /preview iframe
          if (driveEmbed) {
            return (
              <div key={i}
                className="mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-black block"
                style={{
                  aspectRatio: '16 / 9',
                  width: 'min(100%, calc(65vh * 16 / 9))',
                }}
              >
                <iframe
                  src={driveEmbed}
                  className="w-full h-full block"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="動画"
                />
              </div>
            );
          }

          // 3. YouTube URL っぽいが ID 抽出失敗 → サムネイルカード
          //    （Shorts の保険等。hqdefault は ID があれば必ず取れるのでここは到達しないはずだが念のため）
          if (isYoutubeUrl) {
            return (
              <a key={i} href={url} target="_blank" rel="noreferrer"
                className="mx-auto flex items-center justify-center rounded-md border-2 border-dashed border-red-300 bg-red-50 text-red-700 text-sm hover:bg-red-100 transition"
                style={{ aspectRatio: '16 / 9', width: 'min(100%, calc(40vh * 16 / 9))' }}
                title="YouTube で再生"
              >
                ▶ YouTube で開く
              </a>
            );
          }

          // 4. 何も判定不可 → 通常リンク
          return (
            <a key={i} href={url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-brand-blue underline">
              🎬 動画を開く
            </a>
          );
        }

        if (block.type === 'pdf') {
          const embed = googleDriveEmbedUrl(block.url);
          // PDF: プレゼンスライド (16:9 横長) を1ページ大表示する想定で動画と同じアスペクト比に統一。
          // 縦長 PDF (A4 等) は内部で Google Drive プレビューが自動スクロール表示する。
          return embed ? (
            <div key={i}
              className="mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-white block"
              style={{
                aspectRatio: '16 / 9',
                width: 'min(100%, calc(65vh * 16 / 9))',
              }}
            >
              <iframe src={embed} className="w-full h-full block" title={block.label || 'PDF'} />
            </div>
          ) : (
            <a key={i} href={block.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 text-blue-700 text-sm hover:bg-blue-100 transition">
              📁 {block.label || 'PDFを開く'}
            </a>
          );
        }

        return null;
      })}
    </div>
  );
}
