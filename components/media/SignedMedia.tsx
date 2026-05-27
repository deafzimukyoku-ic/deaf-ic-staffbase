'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSignedMediaUrl } from '@/lib/hooks/useSignedMediaUrl';

/* Supabase Storage 上のメディア (画像/動画/PDF) を短期 Signed URL で表示する。
   退職者は API が 403 を返すため、自然にエラー表示に切り替わる。

   ビューア保護 (2026-05-27 / diletto 20e7406 移植):
     - controlsList="nodownload" / disablePictureInPicture (動画) で UI 上の DL/PiP 削除
     - onContextMenu prevent で右クリック「保存」を無効化
     - draggable={false} (画像) でドラッグ保存を抑止
     - ウォーターマーク: 視聴者の氏名 + 社員番号を右上に半透明表示 → 録画/スクショされても流出時に追跡可能
     - 独自フルスクリーンボタン: 親 div を fullscreen 化することで wedge ウォーターマークが消えない
       (<video> / <img> / <iframe> 単体 fullscreen だと兄弟 div の watermark が見えなくなるため)

   技術的限界の明示:
     - OS レベルの画面録画は Web 側から防止不可。ウォーターマークで追跡可能化により抑止
     - PDF iframe 内側のブラウザ標準 viewer の DL/印刷ボタンも cross-origin で制御不可 */

interface BaseProps {
  storagePath: string;
  className?: string;
  style?: React.CSSProperties;
}

/* 任意の HTMLElement を「親ごと fullscreen」する共通 hook。
   <video> / <img> / <iframe(PDF)> がそれぞれ単独 fullscreen するとウォーターマークが
   兄弟 div として隠れるため、親 div をまとめて fullscreen にしてウォーターマークも
   一緒に拡大する。iOS Safari の webkit プレフィックスもフォールバック。 */
function useFullscreenContainer<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      const fsEl = document.fullscreenElement || doc.webkitFullscreenElement;
      setIsFullscreen(fsEl === ref.current);
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler as EventListener);
    };
  }, []);

  const toggle = async () => {
    const el = ref.current;
    if (!el) return;
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element;
        webkitExitFullscreen?: () => Promise<void>;
      };
      const elWk = el as T & { webkitRequestFullscreen?: () => Promise<void> };
      const fsEl = document.fullscreenElement || doc.webkitFullscreenElement;
      if (fsEl === el) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (elWk.webkitRequestFullscreen) await elWk.webkitRequestFullscreen();
      }
    } catch (e) {
      console.warn('[useFullscreenContainer] toggle failed', e);
    }
  };

  return { ref, isFullscreen, toggle };
}

/* フルスクリーン切替アイコン (拡大 / 縮小) を共通化 */
function FullscreenButton({ isFullscreen, onToggle, position = 'top-left' }: {
  isFullscreen: boolean;
  onToggle: () => void;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}) {
  const posClass = {
    'top-left': 'top-2 left-2',
    'top-right': 'top-2 right-2',
    'bottom-left': 'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2',
  }[position];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isFullscreen ? '全画面表示を解除' : '全画面表示'}
      title={isFullscreen ? '全画面表示を解除' : '全画面表示'}
      className={`absolute ${posClass} w-9 h-9 flex items-center justify-center rounded bg-black/50 hover:bg-black/70 text-white transition opacity-70 hover:opacity-100 z-10`}
    >
      {isFullscreen ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3v4a1 1 0 0 1-1 1H3M21 8h-4a1 1 0 0 1-1-1V3M3 16h4a1 1 0 0 1 1 1v4M16 21v-4a1 1 0 0 1 1-1h4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />
        </svg>
      )}
    </button>
  );
}

/* ウォーターマーク (画像/動画/PDF 共通) */
function WatermarkLabel({ text, isFullscreen }: { text: string; isFullscreen: boolean }) {
  return (
    <div className={isFullscreen
      ? 'absolute top-6 right-8 pointer-events-none text-white text-base font-bold opacity-50 select-none [text-shadow:_0_1px_2px_rgb(0_0_0_/_70%)] z-10'
      : 'absolute top-3 right-3 pointer-events-none text-white text-xs font-bold opacity-40 select-none [text-shadow:_0_1px_2px_rgb(0_0_0_/_60%)] z-10'}>
      {text}
    </div>
  );
}

/* 視聴者の氏名 + 社員番号を employees から取得してウォーターマーク文字列を返す。
   取得失敗時は空文字 (ウォーターマーク非表示)。 */
function useViewerWatermark(): string {
  const [text, setText] = useState<string>('');
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || ctrl.signal.aborted) return;
        const { data } = await supabase
          .from('employees')
          .select('last_name, first_name, employee_number')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (!data || ctrl.signal.aborted) return;
        const name = `${data.last_name || ''} ${data.first_name || ''}`.trim();
        const empNo = data.employee_number ? ` / ${data.employee_number}` : '';
        setText(name + empNo);
      } catch {
        /* ウォーターマーク取得失敗は静かに無視 (再生は続行可能) */
      }
    })();
    return () => ctrl.abort();
  }, []);
  return text;
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
  const watermark = useViewerWatermark();
  const { ref: containerRef, isFullscreen, toggle: toggleFullscreen } = useFullscreenContainer<HTMLDivElement>();

  if (loading && !url) {
    return <MediaSkeleton className={`max-h-[65vh] w-full ${className ?? ''}`} />;
  }
  if (error || !url) {
    return <MediaError message={error || 'URL 未取得'} onRetry={() => location.reload()} />;
  }
  /* 旧仕様 <a target="_blank"> による別タブ原寸表示は廃止 (ダウンロード抑止)。
     代わりに独自フルスクリーンで原寸 + ウォーターマーク維持。
     onContextMenu / draggable=false / select-none で右クリック保存・ドラッグ保存を物理ブロック。 */
  return (
    <figure className="space-y-1">
      <div
        ref={containerRef}
        className={isFullscreen
          ? 'relative w-screen h-screen bg-black flex items-center justify-center'
          : 'relative mx-auto max-w-full inline-block'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt || caption || ''}
          onContextMenu={(e) => e.preventDefault()}
          draggable={false}
          className={isFullscreen
            ? `max-w-full max-h-full object-contain select-none ${className ?? ''}`
            : `max-w-full max-h-[65vh] rounded-md border border-brand-gray/10 object-contain select-none ${className ?? ''}`}
          style={style}
        />
        {watermark && <WatermarkLabel text={watermark} isFullscreen={isFullscreen} />}
        <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} position="top-left" />
      </div>
      {caption && (
        <figcaption className="text-xs text-brand-gray-light text-center">{caption}</figcaption>
      )}
    </figure>
  );
}

export function SignedMediaVideo({ storagePath, className, style }: BaseProps) {
  const { url, loading, error } = useSignedMediaUrl(storagePath);
  const watermark = useViewerWatermark();
  const { ref: containerRef, isFullscreen, toggle: toggleFullscreen } = useFullscreenContainer<HTMLDivElement>();
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
  /* 標準フルスクリーンボタンは controlsList="nofullscreen" で無効化し、
     独自ボタンで親 div を fullscreen 化 (watermark を一緒に拡大するため)。 */
  return (
    <div
      ref={containerRef}
      className={isFullscreen
        ? 'relative w-screen h-screen bg-black flex items-center justify-center'
        : `mx-auto relative rounded-md overflow-hidden border border-brand-gray/10 bg-brand-gray/10 block ${className ?? ''}`}
      style={isFullscreen ? undefined : containerStyle}
    >
      <video
        src={url}
        className={isFullscreen
          ? 'max-w-full max-h-full object-contain'
          : 'w-full h-full object-contain block'}
        controls
        controlsList="nodownload nofullscreen"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        playsInline
        preload="metadata"
      />
      {watermark && <WatermarkLabel text={watermark} isFullscreen={isFullscreen} />}
      <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} position="top-left" />
    </div>
  );
}

export function SignedMediaPdf({ storagePath, label, className, style }: BaseProps & { label?: string }) {
  const { url, loading, error } = useSignedMediaUrl(storagePath);
  const watermark = useViewerWatermark();
  const { ref: containerRef, isFullscreen, toggle: toggleFullscreen } = useFullscreenContainer<HTMLDivElement>();
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
  /* 自前「別タブで開く」リンクは削除 (DL 抑止)。
     iframe 内側のブラウザ標準 PDF viewer の DL/印刷ボタンは cross-origin で Web 側制御不可。
     ウォーターマークで追跡可能化することで抑止。
     右クリックは iframe の外側だけ無効化 (iframe 内は cross-origin で制御不可)。 */
  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      className={isFullscreen
        ? 'relative w-screen h-screen bg-black flex items-center justify-center'
        : `relative mx-auto rounded-md overflow-hidden border border-brand-gray/10 bg-white block ${className ?? ''}`}
      style={isFullscreen ? undefined : containerStyle}
    >
      <iframe src={url} className="w-full h-full block" title={label || 'PDF'} />
      {watermark && <WatermarkLabel text={watermark} isFullscreen={isFullscreen} />}
      <FullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} position="top-left" />
    </div>
  );
}
