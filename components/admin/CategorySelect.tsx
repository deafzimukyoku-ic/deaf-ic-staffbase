'use client';

import { useEffect, useState } from 'react';
import type { Category, CategoryType } from '@/lib/types';

interface Props {
  type: CategoryType;
  value: string | null;
  onChange: (id: string | null) => void;
  includeAllOption?: boolean; // フィルタ用「すべて」選択肢
  label?: string;
  className?: string;
}

// 色バッジ＋絵文字付きのカテゴリ選択。NULL = 未分類。
export function CategorySelect({
  type,
  value,
  onChange,
  includeAllOption,
  label,
  className,
}: Props) {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/categories?type=${type}`);
      if (!res.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const data: Category[] = await res.json();
      if (!cancelled) {
        setCats(data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [type]);

  const selected = cats.find(c => c.id === value) || null;

  return (
    <div className={className}>
      {label && <label className="text-[11px] text-diletto-gray-light block mb-1">{label}</label>}
      <div className="flex items-center gap-2">
        {selected && (
          <>
            <span className="text-base">{selected.icon}</span>
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
              aria-hidden
            />
          </>
        )}
        <select
          value={value ?? (includeAllOption ? '__all__' : '')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__all__') onChange(null);
            else if (v === '') onChange(null);
            else onChange(v);
          }}
          disabled={loading}
          className="flex-1 rounded-md border border-diletto-gray/20 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-diletto-blue/30"
        >
          {includeAllOption && <option value="__all__">すべて</option>}
          <option value="">未分類</option>
          {cats.map(c => (
            <option key={c.id} value={c.id}>
              {c.icon}  {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// バッジ表示（社員画面・一覧カードで使用）
// 視認性向上: テキストを少し大きく、影付き、フォント太め
//
// カテゴリは作成時に必須（コンテンツはカテゴリ内に作る運用）のため、
// category が null になるケースはほぼ存在しない。万一 null だったら
// バッジ自体を非表示（旧仕様の「未分類」バッジは見栄え上削除）。
export function CategoryBadge({ category }: { category: Category | null | undefined }) {
  if (!category) {
    return null;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-sm"
      style={{
        backgroundColor: category.color,
        // 文字を確実に読めるようにテキストにわずかな影
        textShadow: '0 1px 1px rgba(0,0,0,0.15)',
      }}
    >
      <span className="text-sm leading-none">{category.icon}</span>
      <span>{category.name}</span>
    </span>
  );
}
