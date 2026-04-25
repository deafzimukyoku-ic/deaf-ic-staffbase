'use client';

import type { Category } from '@/lib/types';

// カテゴリピルフィルタ。値: null=すべて / '__unassigned__'=未分類 / id=カテゴリ指定
// 管理画面・社員画面の両方で共用。
interface Props {
  categories: Category[];
  value: string | null;
  onChange: (v: string | null) => void;
}

export function CategoryFilterBar({ categories, value, onChange }: Props) {
  if (categories.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-diletto-gray-light">カテゴリで絞り込み:</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`px-3 py-1 rounded-full text-xs transition-colors ${
          value === null ? 'bg-diletto-ink text-white' : 'bg-diletto-gray/10 text-diletto-gray hover:bg-diletto-gray/20'
        }`}
      >すべて</button>
      {categories.map(c => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs transition-colors ${
            value === c.id ? 'text-white' : 'bg-diletto-gray/10 text-diletto-gray hover:bg-diletto-gray/20'
          }`}
          style={value === c.id ? { backgroundColor: c.color } : undefined}
        >
          <span>{c.icon}</span>{c.name}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange('__unassigned__')}
        className={`px-3 py-1 rounded-full text-xs transition-colors ${
          value === '__unassigned__' ? 'bg-diletto-ink text-white' : 'bg-diletto-gray/10 text-diletto-gray hover:bg-diletto-gray/20'
        }`}
      >未分類</button>
    </div>
  );
}

// フィルタ値に応じて配列を絞り込むヘルパー
export function applyCategoryFilter<T extends { category_id: string | null }>(
  items: T[],
  value: string | null,
): T[] {
  if (value === null) return items;
  if (value === '__unassigned__') return items.filter(i => !i.category_id);
  return items.filter(i => i.category_id === value);
}
