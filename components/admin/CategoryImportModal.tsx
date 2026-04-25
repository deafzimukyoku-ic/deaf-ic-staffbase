'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Category, CategoryType } from '@/lib/types';

/**
 * カテゴリ取り込みモーダル
 * - 他の分類（コピー元）からカテゴリを選択して現在のタブへ取り込む
 * - バッチ API (/api/categories/bulk) で一括登録
 */

const TYPE_LABEL: Record<CategoryType, string> = {
  compliance: '遵守事項',
  training: '研修',
  announcement: 'お知らせ',
  manual: '業務マニュアル',
};

interface Props {
  /** 取り込み先（現在開いているタブ） */
  destinationType: CategoryType;
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void; // 完了時に呼ばれる（親で再ロード）
}

export function CategoryImportModal({ destinationType, isOpen, onClose, onImported }: Props) {
  // コピー元 type（destination 以外のデフォルト）
  const otherTypes = (Object.keys(TYPE_LABEL) as CategoryType[]).filter((t) => t !== destinationType);
  const [sourceType, setSourceType] = useState<CategoryType>(otherTypes[0]);

  const [sourceCategories, setSourceCategories] = useState<Category[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [onConflict, setOnConflict] = useState<'skip' | 'rename'>('skip');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // モーダルが開いた時 / source 変更時にカテゴリ取得
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/categories?type=${sourceType}`);
      if (!cancelled) {
        if (res.ok) {
          const data: Category[] = await res.json();
          setSourceCategories(data);
          // 初期は全選択
          setSelectedIds(new Set(data.map((c) => c.id)));
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceType]);

  // モーダル閉じる時に状態リセット
  useEffect(() => {
    if (!isOpen) {
      setSourceCategories([]);
      setSelectedIds(new Set());
      setOnConflict('skip');
      setSourceType(otherTypes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function toggleAll() {
    if (selectedIds.size === sourceCategories.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sourceCategories.map((c) => c.id)));
    }
  }

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handleImport() {
    if (selectedIds.size === 0) {
      toast.error('取り込むカテゴリを1つ以上選択してください');
      return;
    }
    const items = sourceCategories
      .filter((c) => selectedIds.has(c.id))
      .map((c) => ({ name: c.name, color: c.color, icon: c.icon }));

    setSubmitting(true);
    try {
      const res = await fetch('/api/categories/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: destinationType,
          items,
          on_conflict: onConflict,
        }),
      });
      const json = await res.json() as { inserted?: number; skipped?: number; renamed?: number; error?: string };
      if (!res.ok) {
        toast.error(json.error || '取り込みに失敗しました');
        return;
      }
      const parts: string[] = [];
      if (json.inserted) parts.push(`新規 ${json.inserted}件`);
      if (json.renamed) parts.push(`改名 ${json.renamed}件`);
      if (json.skipped) parts.push(`スキップ ${json.skipped}件`);
      toast.success(`取り込み完了: ${parts.join(' / ') || '0件'}`);
      onImported();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取り込みに失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  const allSelected = selectedIds.size > 0 && selectedIds.size === sourceCategories.length;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-xl sm:!max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>カテゴリを取り込む</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-diletto-gray">
            他の分類で作成したカテゴリ枠をこの「<strong>{TYPE_LABEL[destinationType]}</strong>」に取り込みます。
            紐付いている内容自体はコピーされません（カテゴリの設定だけ）。
          </p>

          {/* コピー元選択 */}
          <div>
            <label className="text-xs font-bold text-diletto-gray-light block mb-1">コピー元</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as CategoryType)}
              className="w-full rounded-md border border-diletto-gray/20 px-3 py-2 text-sm bg-white"
            >
              {otherTypes.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>

          {/* カテゴリリスト */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-diletto-gray-light">取り込むカテゴリ</label>
              <button
                onClick={toggleAll}
                disabled={loading || sourceCategories.length === 0}
                className="text-xs text-diletto-blue hover:underline disabled:text-diletto-gray-light disabled:no-underline"
              >
                {allSelected ? '全解除' : '全選択'}
              </button>
            </div>
            <div className="rounded-md border border-diletto-gray/15 max-h-[300px] overflow-y-auto bg-white">
              {loading ? (
                <p className="p-4 text-sm text-diletto-gray-light text-center">読み込み中...</p>
              ) : sourceCategories.length === 0 ? (
                <p className="p-4 text-sm text-diletto-gray-light text-center">{TYPE_LABEL[sourceType]}にはカテゴリがありません</p>
              ) : (
                <ul className="divide-y divide-diletto-gray/10">
                  {sourceCategories.map((cat) => {
                    const checked = selectedIds.has(cat.id);
                    return (
                      <li key={cat.id} className="flex items-center gap-3 px-3 py-2 hover:bg-diletto-beige/30">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(cat.id)}
                          className="h-4 w-4 cursor-pointer"
                        />
                        <span className="text-base">{cat.icon}</span>
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-sm text-diletto-ink flex-1">{cat.name}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* 重複処理 */}
          <div>
            <label className="text-xs font-bold text-diletto-gray-light block mb-1">同名カテゴリが既にあるとき</label>
            <select
              value={onConflict}
              onChange={(e) => setOnConflict(e.target.value as 'skip' | 'rename')}
              className="w-full rounded-md border border-diletto-gray/20 px-3 py-2 text-sm bg-white"
            >
              <option value="skip">スキップ（重複は取り込まない）</option>
              <option value="rename">「(2)」を付けて取り込む</option>
            </select>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              キャンセル
            </Button>
            <Button onClick={handleImport} disabled={submitting || selectedIds.size === 0}>
              {submitting ? '取り込み中...' : `${selectedIds.size}件 取り込む`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
