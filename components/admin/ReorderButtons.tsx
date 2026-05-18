'use client';

import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

// 並び替え対応テーブル
type ReorderTable = 'compliance_documents' | 'trainings' | 'announcements' | 'manuals' | 'children';

// デフォルトの order カラム名は sort_order。children テーブルだけ display_order。
const ORDER_COLUMN: Record<ReorderTable, string> = {
  compliance_documents: 'sort_order',
  trainings: 'sort_order',
  announcements: 'sort_order',
  manuals: 'sort_order',
  children: 'display_order',
};

interface Props {
  table: ReorderTable;
  itemId: string;
  // items の order フィールド名は任意 (sort_order | display_order) だが、渡す側は読み出したまま渡せばOK
  items: { id: string; sort_order?: number | null; display_order?: number | null }[];
  onReordered: () => void;
}

// 指定アイテムを1つ上／下に入れ替える
// 同じカテゴリ/スコープ内の items 配列（order 昇順）を渡す想定
export function ReorderButtons({ table, itemId, items, onReordered }: Props) {
  const supabase = createClient();
  const col = ORDER_COLUMN[table];
  const index = items.findIndex((i) => i.id === itemId);
  const canUp = index > 0;
  const canDown = index >= 0 && index < items.length - 1;

  function orderOf(row: { sort_order?: number | null; display_order?: number | null }): number | null {
    const raw = col === 'display_order' ? row.display_order : row.sort_order;
    return raw ?? null;
  }

  async function swap(otherIndex: number) {
    const current = items[index];
    const other = items[otherIndex];
    if (!current || !other) return;

    const currentOrder = orderOf(current) ?? index;
    const otherOrder = orderOf(other) ?? otherIndex;

    const { error: e1 } = await supabase.from(table).update({ [col]: otherOrder }).eq('id', current.id);
    const { error: e2 } = await supabase.from(table).update({ [col]: currentOrder }).eq('id', other.id);
    if (e1 || e2) {
      toast.error('並び替えに失敗しました');
      return;
    }
    onReordered();
  }

  return (
    <div className="inline-flex flex-col gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={!canUp}
        onClick={() => canUp && swap(index - 1)}
        aria-label="上へ移動"
        className="w-6 h-5 flex items-center justify-center rounded bg-white border border-brand-gray/15 text-brand-gray hover:bg-brand-beige hover:text-brand-ink disabled:opacity-30 disabled:cursor-not-allowed transition"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <button
        type="button"
        disabled={!canDown}
        onClick={() => canDown && swap(index + 1)}
        aria-label="下へ移動"
        className="w-6 h-5 flex items-center justify-center rounded bg-white border border-brand-gray/15 text-brand-gray hover:bg-brand-beige hover:text-brand-ink disabled:opacity-30 disabled:cursor-not-allowed transition"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}
