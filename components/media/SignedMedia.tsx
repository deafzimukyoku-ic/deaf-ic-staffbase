'use client';
import { useSignedMediaUrl } from '@/lib/hooks/useSignedMediaUrl';

/* Supabase Storage 上のメディア (画像/動画/PDF) を短期 Signed URL で表示する。
   退職者は API が 403 を返すため、自然にエラー表示に切り替わる。 */

interface BaseProps {
  storagePath: string;
  className?: string;
  style?: React.CSSProperties;
}

function MediaSkeleton({ aspectRatio, className }: { aspectRatio?: string; className?: string }) {
  return (
    <div
      className={`bg-brand-gray/10 animate-pulse rounded-md ${className ?? ''}`}
      style={aspectRatio ? { aspectRatio } : undefined}
      aria-busy="true"
    />
  );
}

function MediaError({
  message,
  onRetry,
  aspectRatio,
  className,
}: {
  message: string;
  onRetry?: () => void;
  aspectRatio?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-brand-red/30 bg-brand-red/5 p-4 text-center text-xs text-brand-red ${className ?? ''}`}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      <p>メディアの取得に失敗しました</p>
      <p className="text-[10px] text-brand-gray">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 px-2 py-1 rounded border border-brand-red/30 hover:bg-brand-red/10"
        >
          再読み込み
        </button>
      )}
    </div>
  );
}

export function SignedMediaImage({
  storagePath,
  alt,
  caption,
  className,
  style,
}: BaseProps & { alt?: string; caption?: string }) {
  const { url, loading, error } = useSignedMediaUrl(storagePath);
  if (loading && !url) {
    return <MediaSkeleton className={`max-h-[65vh] w-full ${className ?? ''}`} />;
  }
  if (error || !url) {
    return <MediaError message={error || 'URL 未取得'} onRetry={() => location.reload()} />;
  }
  return (
    <figure className="space-y-1">
      <a href={url} target="_blank" rel="noreferrer" className="block" title="クリックで原寸表示">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt || caption || ''}
          className={`max-w-full max-h-[65vh] mx-auto rounded-md border border-brand-gray/10 object-contain cursor-zoom-in ${className ?? ''}`}
          style={style}
        />
      </a>
      {caption && (
        <figcaption className="text-xs text-brand-gray-light text-center">{caption}</figcaption>
      )}
    </figure>
  );
}

export function SignedMediaVideo({ storagePath, className, style }: BaseProps) {
  const { url, loading, error } = useSignedMediaUrl(storagePath);
  const aspectRatio = '16 / 9';
  const containerStyle: React.CSSProperties = {
    aspectRatio,
    width: 'min(100%, calc(65vh * 16 / 9))',
    ...style,
  };
  if (loading && !url) {
    return (
      <div className="mx-auto" style={containerStyle}>
        <MediaSkeleton className="w-full h-full" />
      </div>
    );
  }
  if (error || !url) {
    return (
      <div className="mx-auto" style={containerStyle}>
        <MediaError
          message={error || 'URL 未取得'}
          onRetry={() => location.reload()}
          className="w-full h-full"
        />
      </div>
    );
  }
  return (
    <div
      className={`mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-brand-gray/10 block ${className ?? ''}`}
      style={containerStyle}
    >
      <video
        src={url}
        className="w-full h-full object-contain block"
        controls
        playsInline
        preload="metadata"
      />
    </div>
  );
}

export function SignedMediaPdf({ storagePath, label, className, style }: BaseProps & { label?: string }) {
  const { url, loading, error } = useSignedMediaUrl(storagePath);
  const aspectRatio = '16 / 9';
  const containerStyle: React.CSSProperties = {
    aspectRatio,
    width: 'min(100%, calc(65vh * 16 / 9))',
    ...style,
  };
  if (loading && !url) {
    return (
      <div className="mx-auto" style={containerStyle}>
        <MediaSkeleton className="w-full h-full" />
      </div>
    );
  }
  if (error || !url) {
    return (
      <div className="mx-auto" style={containerStyle}>
        <MediaError
          message={error || 'URL 未取得'}
          onRetry={() => location.reload()}
          className="w-full h-full"
        />
      </div>
    );
  }
  /* PDF は iframe inline 表示。モバイルで崩れる場合のため別タブリンクも併設。 */
  return (
    <div className="space-y-2">
      <div
        className={`mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-white block ${className ?? ''}`}
        style={containerStyle}
      >
        <iframe src={url} className="w-full h-full block" title={label || 'PDF'} />
      </div>
      <div className="text-center">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-brand-blue underline"
        >
          📁 別タブで開く{label ? `（${label}）` : ''}
        </a>
      </div>
    </div>
  );
}
