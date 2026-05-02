'use client';

/**
 * 統一ドラッグ並び替えユーティリティ
 *
 * 利用方法:
 *   <DragSortList onReorder={handleReorder}>
 *     {items.map((item, idx) => (
 *       <DragSortItem key={item.id} index={idx}>
 *         {(handleProps) => (
 *           <Card>
 *             <DragHandleIcon {...handleProps} />
 *             ...row content
 *           </Card>
 *         )}
 *       </DragSortItem>
 *     ))}
 *   </DragSortList>
 *
 * 各リストは独立した React Context を作るため、複数リストが同一ページにあっても
 * 状態が混ざらない。ハンドル UI は 6点グリップに統一（ChildrenSettingsFull 等と同一）。
 */

import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

interface DragSortContextValue {
  draggingIdx: number | null;
  dragOverIdx: number | null;
  setDraggingIdx: (i: number | null) => void;
  setDragOverIdx: (i: number | null) => void;
  performDrop: (toIdx: number) => void;
}

const DragSortCtx = createContext<DragSortContextValue | null>(null);

interface DragSortListProps {
  children: ReactNode;
  onReorder: (from: number, to: number) => void | Promise<void>;
  className?: string;
  as?: 'div' | 'ul' | 'tbody';
}

export function DragSortList({ children, onReorder, className, as = 'div' }: DragSortListProps) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const performDrop = useCallback(
    (toIdx: number) => {
      if (draggingIdx == null || draggingIdx === toIdx) return;
      void onReorder(draggingIdx, toIdx);
    },
    [draggingIdx, onReorder],
  );

  const Tag = as as 'div';
  return (
    <DragSortCtx.Provider value={{ draggingIdx, dragOverIdx, setDraggingIdx, setDragOverIdx, performDrop }}>
      <Tag className={className}>{children}</Tag>
    </DragSortCtx.Provider>
  );
}

interface DragSortItemProps {
  index: number;
  children: (handleProps: HandleProps) => ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'tr';
  /** 行コンテナ自体の style/className に渡したい場合、children の戻り値で受け取れる */
  style?: React.CSSProperties;
}

interface HandleProps {
  /** 6点グリップ要素に展開する props */
  draggable: true;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  /** ドラッグ中フラグ（不透明度等の表現用） */
  isDragging: boolean;
  isDropTarget: boolean;
}

export function DragSortItem({ index, children, className, as = 'div', style }: DragSortItemProps) {
  const ctx = useContext(DragSortCtx);
  if (!ctx) throw new Error('DragSortItem must be inside <DragSortList>');
  const isDragging = ctx.draggingIdx === index;
  const isDropTarget = ctx.dragOverIdx === index && ctx.draggingIdx !== null && ctx.draggingIdx !== index;

  const Tag = as as 'div';

  return (
    <Tag
      className={className}
      style={{
        opacity: isDragging ? 0.4 : 1,
        ...style,
      }}
      onDragOver={(e) => {
        if (ctx.draggingIdx == null || ctx.draggingIdx === index) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        ctx.setDragOverIdx(index);
      }}
      onDragLeave={() => {
        if (ctx.dragOverIdx === index) ctx.setDragOverIdx(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        ctx.performDrop(index);
        ctx.setDraggingIdx(null);
        ctx.setDragOverIdx(null);
      }}
    >
      {children({
        draggable: true,
        onDragStart: (e) => {
          ctx.setDraggingIdx(index);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(index));
        },
        onDragEnd: () => {
          ctx.setDraggingIdx(null);
          ctx.setDragOverIdx(null);
        },
        isDragging,
        isDropTarget,
      })}
    </Tag>
  );
}

interface DragHandleIconProps extends Partial<HandleProps> {
  className?: string;
  ariaLabel?: string;
}

/** 6点グリップアイコン（StaffSettingsFull / ChildrenSettingsFull と同じ見た目） */
export function DragHandleIcon({
  draggable,
  onDragStart,
  onDragEnd,
  isDragging,
  className,
  ariaLabel = 'ドラッグして並び替え',
}: DragHandleIconProps) {
  return (
    <div
      draggable={draggable ?? false}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => e.stopPropagation()}
      className={
        className ??
        'inline-flex items-center justify-center w-6 h-7 rounded transition-colors hover:bg-[var(--bg)] shrink-0'
      }
      style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <svg width="14" height="18" viewBox="0 0 14 18" fill="var(--ink-3)" aria-hidden>
        <circle cx="4" cy="4" r="1.3" />
        <circle cx="10" cy="4" r="1.3" />
        <circle cx="4" cy="9" r="1.3" />
        <circle cx="10" cy="9" r="1.3" />
        <circle cx="4" cy="14" r="1.3" />
        <circle cx="10" cy="14" r="1.3" />
      </svg>
    </div>
  );
}

/**
 * ReorderButtons の置き換え用ヘルパ。
 * sort_order / display_order を使う既存の 4 機能 + children 用に
 * supabase update を内部実行する。
 *
 * 親側は <DragSortList onReorder={(from, to) => helper.swap(from, to)}> ... </DragSortList>
 * のように使う。
 */
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type ReorderTable = 'compliance_documents' | 'trainings' | 'announcements' | 'manuals' | 'children';

const ORDER_COLUMN: Record<ReorderTable, string> = {
  compliance_documents: 'sort_order',
  trainings: 'sort_order',
  announcements: 'sort_order',
  manuals: 'sort_order',
  children: 'display_order',
};

interface ReorderableItem {
  id: string;
  sort_order?: number | null;
  display_order?: number | null;
}

/**
 * リスト全体を一括再採番する形で並び替えを保存する。
 * - 既存値が混在していてもインデックス順に正規化されるので堅牢
 */
export async function reorderViaSortColumn(
  table: ReorderTable,
  items: ReorderableItem[],
  fromIdx: number,
  toIdx: number,
  onChanged: () => void,
): Promise<void> {
  if (fromIdx === toIdx) return;
  const supabase = createClient();
  const col = ORDER_COLUMN[table];
  const reordered = [...items];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);

  /* 全件 update（件数は数十程度なので並列でOK） */
  const results = await Promise.all(
    reordered.map((item, idx) => supabase.from(table).update({ [col]: idx }).eq('id', item.id)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    toast.error('並び替えに失敗しました', { description: failed.error.message });
    return;
  }
  onChanged();
}
