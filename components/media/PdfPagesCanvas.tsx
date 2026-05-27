'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/* PDF の全ページを <canvas> に縦並びレンダリングするモバイル安全な PDF ビューア。

   背景: <iframe src="...pdf"> 埋め込みは iOS Safari / iOS Chrome / iOS WKWebView で
   1 ページ目しか描画されない既知制約があり、モバイルから既読 (ack/read) を立てた
   ユーザーが本文を読めていない事故を生んでいた。pdf.js で各ページを Canvas に
   描画し、iframe の代替とする。

   - IntersectionObserver で表示直前に各ページを render → 多ページ PDF でも軽い
   - devicePixelRatio スケールで Retina 高解像度
   - draggable=false + onContextMenu prevent でブラウザ標準 DL を抑止
     (iframe 標準 PDF ビューアの DL ボタンが描画されなくなるため、保護は iframe より強い) */

const PDFJS_WORKER_SRC = '/pdf.worker.min.mjs';

type Props = {
  /** 短期 Signed URL や同 Origin の PDF URL */
  url: string;
  /** ページ間スペース (px) */
  pageGap?: number;
  /** PDF 全体のラベル (aria-label 用) */
  label?: string;
};

export function PdfPagesCanvas({ url, pageGap = 8, label }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let docRef: PDFDocumentProxy | null = null;

    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
        /* disableRange/disableStream で初回 1 回フルダウンロードに固定する。
           短期 signed URL (TTL 10 分) を範囲リクエストで遅延 fetch すると、
           ページ render 時に URL 失効して 400 (InvalidJWT exp claim) を踏む。
           初回ダウンロード完了後は in-memory データで getPage が走るため URL 不要。 */
        const loadingTask = pdfjsLib.getDocument({
          url,
          disableRange: true,
          disableStream: true,
        });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        docRef = doc;
        setPdf(doc);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
      }
    })();

    return () => {
      cancelled = true;
      void docRef?.destroy();
    };
  }, [url]);

  if (loadError) {
    return (
      <p className="text-xs text-center text-red-600 px-4 py-8" role="alert">
        PDF を読み込めませんでした: {loadError}
      </p>
    );
  }

  if (!pdf) {
    return (
      <div
        className="bg-black/5 animate-pulse rounded mx-auto"
        style={{ aspectRatio: '8.5 / 11', width: '100%', maxWidth: 800 }}
        aria-busy="true"
        aria-label={label ? `${label} を読み込み中` : 'PDF を読み込み中'}
      />
    );
  }

  return (
    <div
      className="flex flex-col items-center"
      style={{ gap: pageGap }}
      aria-label={label}
    >
      {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((pageNum) => (
        <PdfPage key={pageNum} pdf={pdf} pageNum={pageNum} totalPages={pdf.numPages} />
      ))}
    </div>
  );
}

function PdfPage({
  pdf,
  pageNum,
  totalPages,
}: {
  pdf: PDFDocumentProxy;
  pageNum: number;
  totalPages: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  /* placeholder の高さを正しく確保するため、ページの aspect ratio を先に取る。
     これをやらないと多ページ PDF の placeholder が全部ゼロ高で IntersectionObserver
     の rootMargin が即座にヒットしてしまい、全ページが一斉に render される。 */
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setAspect(vp.height / vp.width);
      } catch {
        /* ページ情報取得失敗 → render 時にもう一度試みる。placeholder は出ない */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNum]);

  useEffect(() => {
    if (rendered) return;
    const el = wrapRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void renderPage();
        }
      },
      { rootMargin: '500px 0px' },
    );
    observer.observe(el);

    async function renderPage() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const page = await pdf.getPage(pageNum);
        const containerWidth = canvas.parentElement?.clientWidth ?? 800;
        const baseVp = page.getViewport({ scale: 1 });
        const cssScale = containerWidth / baseVp.width;
        const dpr = window.devicePixelRatio || 1;
        const renderVp = page.getViewport({ scale: cssScale * dpr });

        canvas.width = Math.floor(renderVp.width);
        canvas.height = Math.floor(renderVp.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({
          canvasContext: ctx,
          viewport: renderVp,
        } as Parameters<typeof page.render>[0]).promise;
        setRendered(true);
      } catch {
        /* レンダ失敗時は placeholder のまま残す。次回スクロールで再試行は無いが
           load 自体は成功しているので「読み込みエラー」よりは情報的に正確 */
      }
    }

    return () => observer.disconnect();
  }, [pdf, pageNum, rendered]);

  return (
    <div
      ref={wrapRef}
      className="w-full"
      style={
        aspect && !rendered
          ? { aspectRatio: `1 / ${aspect}`, backgroundColor: 'rgba(0,0,0,0.04)' }
          : undefined
      }
      aria-label={`${pageNum} / ${totalPages}`}
    >
      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        className="block select-none w-full h-auto"
      />
    </div>
  );
}
