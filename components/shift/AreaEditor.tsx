'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { AreaLabel } from '@/lib/types';

interface Props {
  label: string;
  // エリア定義の配列（この児童専用）
  areas: AreaLabel[];
  // 有効化されているエリアの id 配列
  selectedIds: string[];
  onChange: (areas: AreaLabel[], selectedIds: string[]) => void;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// エリア定義の追加・削除・有効チェックを一画面で扱う小さなエディタ。
// children 画面で迎/送の2箇所に使う。
export function AreaEditor({ label, areas, selectedIds, onChange }: Props) {
  const [newEmoji, setNewEmoji] = useState('');
  const [newName, setNewName] = useState('');

  function addArea() {
    const emoji = newEmoji.trim();
    const name = newName.trim();
    if (!name) return;
    const next: AreaLabel = {
      id: genId(),
      emoji: emoji || '📍',
      name,
    };
    onChange([...areas, next], [...selectedIds, next.id]);
    setNewEmoji('');
    setNewName('');
  }

  function removeArea(id: string) {
    onChange(
      areas.filter((a) => a.id !== id),
      selectedIds.filter((x) => x !== id)
    );
  }

  function toggleSelected(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange(areas, next);
  }

  return (
    <div className="space-y-3 rounded-md border border-brand-gray/10 p-4 bg-gray-50/50">
      <Label className="text-sm font-bold text-brand-ink">{label}</Label>

      {areas.length === 0 && (
        <p className="text-xs text-brand-gray-light py-2">まだエリアがありません。下のフォームから追加してください。</p>
      )}

      {areas.length > 0 && (
        <div className="space-y-1">
          {areas.map((a) => {
            const checked = selectedIds.includes(a.id);
            return (
              <div
                key={a.id}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                  checked ? 'bg-white border-brand-blue/30' : 'bg-white/50 border-brand-gray/10'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelected(a.id)}
                  className="h-4 w-4 accent-brand-blue cursor-pointer"
                  aria-label={`${a.name} を有効化`}
                />
                <span className="text-lg shrink-0">{a.emoji}</span>
                <span className="text-sm flex-1 text-brand-ink">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeArea(a.id)}
                  className="text-xs text-brand-red hover:underline"
                  aria-label={`${a.name} を削除`}
                >
                  削除
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 items-end pt-2 border-t border-brand-gray/10">
        <div className="w-20">
          <Label className="text-[10px] text-brand-gray-light">絵文字</Label>
          <Input
            value={newEmoji}
            onChange={(e) => setNewEmoji(e.target.value)}
            placeholder="🏠"
            maxLength={2}
            className="h-9 text-center"
          />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] text-brand-gray-light">エリア名</Label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例: 自宅・〇〇学校"
            className="h-9"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } }}
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={addArea}
          disabled={!newName.trim()}
          className="h-9"
        >
          + 追加
        </Button>
      </div>
    </div>
  );
}
