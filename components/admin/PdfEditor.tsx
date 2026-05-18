'use client';

/**
 * PDF エディタ本体: Fabric.js キャンバス + pdfjs-dist 背景
 * DocMerge TemplateCanvas.tsx ベース — 装飾機能除去、font_size のみ
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, FabricImage, FabricText, Group, Rect, Line, type FabricObject } from 'fabric';
import type { PdfTag, PdfTagPlacement } from '@/lib/types';
import { DEFAULT_FONT_SIZE } from '@/lib/constants';

function getData(obj: FabricObject): { placementId?: string; tagId?: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (obj as any).data ?? {};
}

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200] as const;
const DEFAULT_ZOOM_INDEX = 2;
const BADGE_PAD_X = 6;
const BADGE_PAD_Y = 3;
const PDFJS_WORKER_SRC = '/pdf.worker.min.mjs';
const SNAP_THRESHOLD = 8; // px以内でスナップ

interface PageCanvas {
  canvas: Canvas;
  pageNumber: number;
  fitScale: number;
}

interface Props {
  pdfUrl: string;
  tags: PdfTag[];
  placements: PdfTagPlacement[];
  onPlacementsChange: (placements: PdfTagPlacement[]) => void;
  onSelectPlacement: (placement: PdfTagPlacement | null) => void;
  selectedPlacementId: string | null;
}

export default function PdfEditor({
  pdfUrl,
  tags,
  placements,
  onPlacementsChange,
  onSelectPlacement,
  selectedPlacementId,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const canvasesRef = useRef<PageCanvas[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [wrapperWidth, setWrapperWidth] = useState(0);
  const placementsRef = useRef(placements);
  placementsRef.current = placements;

  const zoomPercent = ZOOM_STEPS[zoomIndex];

  // wrapper幅監視
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // 初回のみ幅を取得（スクロールバー出現による無限ループ防止）
    const w = Math.floor(wrapper.clientWidth);
    if (w > 0) setWrapperWidth(w);
    // ウィンドウリサイズ時のみ再計測
    const onResize = () => {
      const nw = Math.floor(wrapper.clientWidth);
      if (nw > 0) setWrapperWidth(nw);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function addTagToCanvas(
    canvas: Canvas,
    tag: PdfTag,
    placement: PdfTagPlacement,
    fitScale: number,
  ) {
    const scaledFontSize = placement.font_size * fitScale;

    /* タグ表示形式: |__○○__
       | = 差し込み開始マーカー（PDF 生成時の placement.x に正確に一致）
       __○○__ = タグ名（前後アンダースコア）
       装飾なし、テキストのみ。点線ボックスは廃止（| の位置と箱左端の混同を防ぐ）。
       「| が見えてる場所から実際に文字が差し込まれる」という対応関係で迷い無し。 */
    const textObj = new FabricText(`|__${tag.display_name}__`, {
      fontSize: scaledFontSize,
      fontFamily: 'IPAex Mincho, MS Mincho, serif',
      fill: '#1a3eb8', /* タグだと一目で分かるよう青で表示。差し込み後の値は黒で出る */
      originX: 'left',
      originY: 'top',
    });

    /* group は text + ヒットエリア用の透明 rect。
       rect は text と完全に同じ位置/サイズで、ドラッグハンドル用にだけ存在。
       ※ オフセットを 0 に揃えることで group.left = placement.x * fitScale が
         そのまま | の位置になり、ドラッグ後の保存も逆換算が単純（割るだけ）。 */
    const hitRect = new Rect({
      width: (textObj.width ?? 0),
      height: (textObj.height ?? 0),
      fill: 'transparent',
      stroke: 'transparent',
      originX: 'left',
      originY: 'top',
      left: 0,
      top: 0,
    });

    const group = new Group([hitRect, textObj], {
      left: placement.x * fitScale,
      top: placement.y * fitScale,
      originX: 'left',
      originY: 'top',
      hasControls: false,
      hasBorders: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (group as any).data = { placementId: placement.id, tagId: tag.id };
    canvas.add(group);
  }

  // PDF描画
  useEffect(() => {
    const area = canvasAreaRef.current;
    if (!area || !pdfUrl || wrapperWidth === 0) return;

    let cancelled = false;

    async function render() {
      if (!area) return;
      setLoading(true);

      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;

        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;

        // 既存canvas破棄
        for (const pc of canvasesRef.current) {
          try { pc.canvas.dispose(); } catch { /* ignore */ }
        }
        canvasesRef.current = [];
        area.innerHTML = '';

        const zoom = zoomPercent / 100;
        const dpr = window.devicePixelRatio || 1;

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const defaultVp = page.getViewport({ scale: 1 });

          const fitScale = (wrapperWidth / defaultVp.width) * zoom;
          const cssWidth = Math.floor(defaultVp.width * fitScale);
          const cssHeight = Math.floor(defaultVp.height * fitScale);

          const hiresScale = fitScale * dpr;
          const hiresVp = page.getViewport({ scale: hiresScale });
          const hiresWidth = Math.floor(hiresVp.width);
          const hiresHeight = Math.floor(hiresVp.height);

          // ページコンテナ
          const pageDiv = document.createElement('div');
          pageDiv.className = 'mb-6';
          pageDiv.style.width = `${cssWidth}px`;

          // ページ番号
          const label = document.createElement('div');
          label.style.cssText = 'font-size:11px;color:#85857e;font-weight:600;margin-bottom:4px;text-align:center;';
          label.textContent = `${i} / ${pdf.numPages}`;
          pageDiv.appendChild(label);

          // 高解像度レンダリング
          const bgCanvas = document.createElement('canvas');
          bgCanvas.width = hiresWidth;
          bgCanvas.height = hiresHeight;
          const bgCtx = bgCanvas.getContext('2d')!;
          await page.render({ canvasContext: bgCtx, viewport: hiresVp } as Parameters<typeof page.render>[0]).promise;
          if (cancelled) return;

          // Fabric.js canvas
          const fabricEl = document.createElement('canvas');
          fabricEl.id = `fabric-page-${i}`;
          fabricEl.width = cssWidth;
          fabricEl.height = cssHeight;
          pageDiv.appendChild(fabricEl);
          area.appendChild(pageDiv);

          const fabricCanvas = new Canvas(fabricEl, {
            width: cssWidth,
            height: cssHeight,
            selection: true,
          });

          const bgDataUrl = bgCanvas.toDataURL('image/png');
          const bgImage = await FabricImage.fromURL(bgDataUrl);
          if (cancelled) { fabricCanvas.dispose(); return; }
          bgImage.set({
            originX: 'left',
            originY: 'top',
            left: 0,
            top: 0,
            selectable: false,
            evented: false,
            scaleX: cssWidth / (bgImage.width ?? cssWidth),
            scaleY: cssHeight / (bgImage.height ?? cssHeight),
          });
          fabricCanvas.backgroundImage = bgImage;
          fabricCanvas.renderAll();

          // タグ復元（refから取得して再レンダリングループを防止）
          const currentPlacements = placementsRef.current;
          const pagePlacements = currentPlacements.filter((p) => p.page_number === i);
          for (const placement of pagePlacements) {
            const tag = tags.find((t) => t.id === placement.tag_id);
            if (tag) addTagToCanvas(fabricCanvas, tag, placement, fitScale);
          }

          // スナップガイド用ライン（キャンバスあたり2本: 水平・垂直）
          const hGuideLine = new Line([0, 0, cssWidth, 0], {
            stroke: '#e53e3e', strokeWidth: 1, strokeDashArray: [4, 3],
            selectable: false, evented: false, visible: false, excludeFromExport: true,
          });
          const vGuideLine = new Line([0, 0, 0, cssHeight], {
            stroke: '#e53e3e', strokeWidth: 1, strokeDashArray: [4, 3],
            selectable: false, evented: false, visible: false, excludeFromExport: true,
          });
          fabricCanvas.add(hGuideLine);
          fabricCanvas.add(vGuideLine);

          // 移動中: スナップ＋ガイド線表示
          const padX = BADGE_PAD_X * fitScale;
          const padY = BADGE_PAD_Y * fitScale;

          fabricCanvas.on('object:moving', (e) => {
            const obj = e.target;
            if (!obj) return;
            const d = getData(obj);
            if (!d.placementId) return;

            const objTop = obj.top ?? 0;
            const objLeft = obj.left ?? 0;
            let snappedH = false;
            let snappedV = false;

            const others = fabricCanvas.getObjects().filter(
              (o) => getData(o).placementId && getData(o).placementId !== d.placementId
            );

            for (const other of others) {
              const otherTop = other.top ?? 0;
              const otherLeft = other.left ?? 0;

              // 水平スナップ（Y座標揃え）
              if (!snappedH && Math.abs(objTop - otherTop) < SNAP_THRESHOLD) {
                obj.set({ top: otherTop });
                hGuideLine.set({ x1: 0, y1: otherTop, x2: cssWidth, y2: otherTop, visible: true });
                snappedH = true;
              }

              // 垂直スナップ（X座標揃え）
              if (!snappedV && Math.abs(objLeft - otherLeft) < SNAP_THRESHOLD) {
                obj.set({ left: otherLeft });
                vGuideLine.set({ x1: otherLeft, y1: 0, x2: otherLeft, y2: cssHeight, visible: true });
                snappedV = true;
              }
            }

            if (!snappedH) hGuideLine.set({ visible: false });
            if (!snappedV) vGuideLine.set({ visible: false });
            fabricCanvas.renderAll();
          });

          // 移動完了: ガイド線を非表示にして座標を保存
          fabricCanvas.on('object:modified', (e) => {
            const obj = e.target;
            if (!obj) return;
            const d = getData(obj);
            if (!d.placementId) return;

            hGuideLine.set({ visible: false });
            vGuideLine.set({ visible: false });
            fabricCanvas.renderAll();

            const updated = placementsRef.current.map((p) => {
              if (p.id !== d.placementId) return p;
              /* 新仕様: group.left/top をそのまま fitScale で割るだけ。
                 padX/padY のオフセット補正は不要（addTagToCanvas が group.left = placement.x * fitScale で配置するため）。 */
              return {
                ...p,
                x: Math.round((obj.left ?? 0) / fitScale),
                y: Math.round((obj.top ?? 0) / fitScale),
              };
            });
            onPlacementsChange(updated);
          });

          fabricCanvas.on('selection:created', (e) => {
            const obj = e.selected?.[0];
            if (!obj) return;
            const d = getData(obj);
            if (d.placementId) {
              const p = placementsRef.current.find((pl) => pl.id === d.placementId);
              onSelectPlacement(p ?? null);
            }
          });

          fabricCanvas.on('selection:updated', (e) => {
            const obj = e.selected?.[0];
            if (!obj) return;
            const d = getData(obj);
            if (d.placementId) {
              const p = placementsRef.current.find((pl) => pl.id === d.placementId);
              onSelectPlacement(p ?? null);
            }
          });

          fabricCanvas.on('selection:cleared', () => {
            onSelectPlacement(null);
          });

          canvasesRef.current.push({ canvas: fabricCanvas, pageNumber: i, fitScale });
        }

        setLoading(false);

        // ズーム後にcanvasを水平中央にスクロール
        requestAnimationFrame(() => {
          const container = scrollContainerRef.current;
          if (container && container.scrollWidth > container.clientWidth) {
            container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2;
          }
        });
      } catch (err) {
        setLoading(false);
      }
    }

    const timer = setTimeout(() => render(), 50);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const pc of canvasesRef.current) {
        try { pc.canvas.dispose(); } catch { /* ignore */ }
      }
      canvasesRef.current = [];
    };
  }, [pdfUrl, zoomPercent, wrapperWidth]);

  // placements/tags変更時にバッジを同期
  useEffect(() => {
    if (canvasesRef.current.length === 0) return;

    for (const pc of canvasesRef.current) {
      const activeObj = pc.canvas.getActiveObject();
      const activeId = activeObj ? getData(activeObj).placementId : null;

      pc.canvas.discardActiveObject();
      const toRemove = pc.canvas.getObjects().filter((o) => getData(o).placementId);
      for (const obj of toRemove) {
        pc.canvas.remove(obj);
      }

      const pagePlacements = placements.filter((p) => p.page_number === pc.pageNumber);
      for (const placement of pagePlacements) {
        const tag = tags.find((t) => t.id === placement.tag_id);
        if (tag) addTagToCanvas(pc.canvas, tag, placement, pc.fitScale);
      }

      if (activeId) {
        const newObj = pc.canvas.getObjects().find((o) => getData(o).placementId === activeId);
        if (newObj) pc.canvas.setActiveObject(newObj);
      }

      pc.canvas.renderAll();
    }
  }, [placements, tags]);

  // 矢印キー移動
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key] as [number, number] | undefined;
      if (!dir) return;

      for (const pc of canvasesRef.current) {
        const obj = pc.canvas.getActiveObject();
        if (!obj) continue;
        const d = getData(obj);
        if (!d.placementId) continue;

        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        obj.set({
          left: (obj.left ?? 0) + dir[0] * step,
          top: (obj.top ?? 0) + dir[1] * step,
        });
        obj.setCoords();
        pc.canvas.renderAll();

        /* 新仕様: padX/padY のオフセット補正は不要（addTagToCanvas で group.left = placement.x * fitScale 配置のため） */
        const updated = placementsRef.current.map((p) =>
          p.id === d.placementId
            ? { ...p, x: Math.round((obj.left ?? 0) / pc.fitScale), y: Math.round((obj.top ?? 0) / pc.fitScale) }
            : p
        );
        onPlacementsChange(updated);
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPlacementsChange]);

  // ドロップ（サイドバーからタグをドラッグ配置）
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const tagId = e.dataTransfer.getData('tagId');
    const tag = tags.find((t) => t.id === tagId);
    const area = canvasAreaRef.current;
    if (!tag || !area) return;

    const areaRect = area.getBoundingClientRect();
    const dropY = e.clientY - areaRect.top + area.scrollTop;

    let accHeight = 0;
    let targetPage: PageCanvas | null = null;
    let offsetY = 0;

    for (const pc of canvasesRef.current) {
      const pageHeight = pc.canvas.getHeight() + 40;
      if (dropY < accHeight + pageHeight) {
        targetPage = pc;
        offsetY = dropY - accHeight - 20;
        break;
      }
      accHeight += pageHeight;
    }

    if (!targetPage) return;

    const offsetX = e.clientX - areaRect.left;
    const newPlacement: PdfTagPlacement = {
      id: `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      tag_id: tagId,
      template_id: '',
      page_number: targetPage.pageNumber,
      x: Math.max(0, Math.round(offsetX / targetPage.fitScale)),
      y: Math.max(0, Math.round(offsetY / targetPage.fitScale)),
      font_size: DEFAULT_FONT_SIZE,
      created_at: '',
      updated_at: '',
    };

    addTagToCanvas(targetPage.canvas, tag, newPlacement, targetPage.fitScale);
    targetPage.canvas.renderAll();
    onPlacementsChange([...placementsRef.current, newPlacement]);
  }, [tags, onPlacementsChange]);

  return (
    <div
      ref={wrapperRef}
      className="h-full flex flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ズームバー */}
      <div className="flex items-center gap-1.5 px-4 h-[36px] border-b border-brand-gray/10 bg-white shrink-0">
        <button
          onClick={() => setZoomIndex((p) => Math.max(p - 1, 0))}
          disabled={zoomIndex === 0}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-brand-gray/20 bg-white text-xs font-medium text-brand-gray hover:bg-brand-bg hover:text-brand-ink disabled:opacity-30 transition-all"
        >
          −
        </button>
        <button
          onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
          className="flex h-7 items-center justify-center rounded-md border border-brand-gray/20 bg-white px-2.5 text-[11px] font-medium text-brand-gray hover:bg-brand-bg hover:text-brand-ink transition-all min-w-[48px]"
        >
          {zoomPercent}%
        </button>
        <button
          onClick={() => setZoomIndex((p) => Math.min(p + 1, ZOOM_STEPS.length - 1))}
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-brand-gray/20 bg-white text-xs font-medium text-brand-gray hover:bg-brand-bg hover:text-brand-ink disabled:opacity-30 transition-all"
        >
          +
        </button>
      </div>

      {/* Canvas本体 */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto bg-brand-bg">
        {loading && (
          <div className="flex items-center justify-center h-64">
            <p className="text-sm text-brand-gray-light">PDFを読み込み中...</p>
          </div>
        )}
        {/* w-max + min-w-full: 拡大時は中身の幅まで広がり横スクロールが効く／縮小時は親幅で中央寄せ */}
        <div ref={canvasAreaRef} className="flex flex-col items-center py-8 w-max min-w-full mx-auto" />
      </div>
    </div>
  );
}
