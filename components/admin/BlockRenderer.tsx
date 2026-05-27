'use client';

import type { ContentBlockJson } from '@/lib/types';
import { SignedMediaImage, SignedMediaVideo, SignedMediaPdf } from '@/components/media/SignedMedia';

// YouTube 動画ID を様々な URL 形式から抽出
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

// Drive ファイル ID 抽出。移行猶予中の旧 Drive リンク描画用。
function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/file\/d\/([\w-]+)/);
  return match ? match[1] : null;
}

function googleDriveEmbedUrl(url: string): string | null {
  const id = extractDriveFileId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

// blocks が空かつ fallbackText がある場合、fallback を単一 text ブロックとして扱う
export function BlockRenderer({
  blocks,
  fallbackText,
}: {
  blocks: ContentBlockJson[] | null | undefined;
  fallbackText?: string | null;
}) {
  const list: ContentBlockJson[] = (blocks && blocks.length > 0)
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
          /* 新形式 (storage_path) → 短期 Signed URL で表示。
             旧形式 (url) → そのまま <img> (10 年 Signed URL の猶予期間)。 */
          if (block.storage_path) {
            return (
              <SignedMediaImage
                key={i}
                storagePath={block.storage_path}
                caption={block.caption}
              />
            );
          }
          if (block.url) {
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
          return null;
        }

        if (block.type === 'video') {
          // 1. 新形式 (Storage 動画) → 短期 Signed URL でネイティブ再生
          if (block.source === 'storage' && block.storage_path) {
            return <SignedMediaVideo key={i} storagePath={block.storage_path} />;
          }

          // 2. YouTube → iframe 埋め込み
          const url = block.url || '';
          const ytId = extractYoutubeId(url);
          const isYoutubeUrl = /(?:youtube\.com|youtu\.be)/i.test(url);
          if (ytId) {
            return (
              <div
                key={i}
                className="mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-brand-gray/10 block"
                style={{
                  aspectRatio: '16 / 9',
                  width: 'min(100%, calc(65vh * 16 / 9))',
                }}
              >
                <iframe
                  src={`https://www.youtube.com/embed/${ytId}`}
                  className="w-full h-full block"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="動画"
                />
              </div>
            );
          }

          // 3. Google Drive 動画 (移行猶予中) → ▶ サムネカードで Drive を新規タブで開く
          //    docs/constraints.md §1 (動画は Function 経由しない) を踏襲。
          //    Phase 3 移行完了後はこの分岐は到達しなくなる。
          const driveId = extractDriveFileId(url);
          if (driveId) {
            return (
              <a
                key={i}
                href={`https://drive.google.com/file/d/${driveId}/view`}
                target="_blank"
                rel="noreferrer"
                className="mx-auto rounded-md overflow-hidden border border-brand-gray/15 bg-gradient-to-br from-brand-blue/5 to-brand-gray/10 block relative group"
                style={{
                  aspectRatio: '16 / 9',
                  width: 'min(100%, calc(65vh * 16 / 9))',
                }}
                title="クリックで Google Drive を開いて再生"
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                  <div className="w-20 h-20 rounded-full bg-brand-blue/90 group-hover:bg-brand-blue group-hover:scale-105 flex items-center justify-center shadow-lg transition-all">
                    <svg className="w-9 h-9 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <p className="mt-4 text-sm font-medium text-brand-ink">動画を再生</p>
                  <p className="mt-1 text-xs text-brand-gray-light">Google Drive を新しいタブで開きます</p>
                </div>
              </a>
            );
          }

          // 4. YouTube URL っぽいが ID 抽出失敗 → サムネイルカード
          if (isYoutubeUrl) {
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="mx-auto flex items-center justify-center rounded-md border-2 border-dashed border-red-300 bg-red-50 text-red-700 text-sm hover:bg-red-100 transition"
                style={{ aspectRatio: '16 / 9', width: 'min(100%, calc(40vh * 16 / 9))' }}
                title="YouTube で再生"
              >
                ▶ YouTube で開く
              </a>
            );
          }

          // 5. 何も判定不可 → 通常リンク
          if (url) {
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-brand-blue underline"
              >
                🎬 動画を開く
              </a>
            );
          }
          return null;
        }

        if (block.type === 'pdf') {
          // 1. 新形式 (Storage PDF) → 短期 Signed URL で iframe 表示 + 別タブリンク
          if (block.source === 'storage' && block.storage_path) {
            return <SignedMediaPdf key={i} storagePath={block.storage_path} label={block.label} />;
          }

          // 2. 旧 Drive PDF (移行猶予中) → 既存の /preview iframe を維持
          if (block.url) {
            const embed = googleDriveEmbedUrl(block.url);
            return embed ? (
              <div
                key={i}
                className="mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-white block"
                style={{
                  aspectRatio: '16 / 9',
                  width: 'min(100%, calc(65vh * 16 / 9))',
                }}
              >
                <iframe src={embed} className="w-full h-full block" title={block.label || 'PDF'} />
              </div>
            ) : (
              <a
                key={i}
                href={block.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 text-blue-700 text-sm hover:bg-blue-100 transition"
              >
                📁 {block.label || 'PDFを開く'}
              </a>
            );
          }
          return null;
        }

        return null;
      })}
    </div>
  );
}
