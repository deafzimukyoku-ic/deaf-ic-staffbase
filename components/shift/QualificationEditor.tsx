'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { QualificationType } from '@/lib/types';

interface Props {
  quals: QualificationType[];
  onChange: (next: QualificationType[]) => void;
}

export function QualificationEditor({ quals, onChange }: Props) {
  const [newName, setNewName] = useState('');
  const [newCountable, setNewCountable] = useState(true);

  function add() {
    const name = newName.trim();
    if (!name) return;
    if (quals.some((q) => q.name === name)) return;
    onChange([...quals, { name, countable: newCountable }]);
    setNewName('');
    setNewCountable(true);
  }

  function remove(name: string) {
    onChange(quals.filter((q) => q.name !== name));
  }

  function toggleCountable(name: string) {
    onChange(quals.map((q) => (q.name === name ? { ...q, countable: !q.countable } : q)));
  }

  return (
    <div className="space-y-3 rounded-md border border-diletto-gray/10 p-4 bg-gray-50/50">
      <div className="flex items-start gap-2">
        <Label className="text-sm font-bold text-diletto-ink flex-1">資格リスト</Label>
        <span className="text-[10px] text-diletto-gray-light">☑ = 有資格者カウント対象</span>
      </div>

      {quals.length === 0 && (
        <p className="text-xs text-diletto-gray-light py-2">まだ資格がありません。下のフォームから追加してください（例: 保育士、児童指導員）。</p>
      )}

      {quals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quals.map((q) => (
            <div
              key={q.name}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 bg-white ${
                q.countable ? 'border-diletto-blue/30' : 'border-diletto-gray/15'
              }`}
            >
              <input
                type="checkbox"
                checked={q.countable}
                onChange={() => toggleCountable(q.name)}
                className="h-4 w-4 accent-diletto-blue cursor-pointer"
                aria-label={`${q.name} のカウント対象`}
              />
              <span className="text-sm text-diletto-ink">{q.name}</span>
              <button type="button" onClick={() => remove(q.name)} className="text-xs text-diletto-red hover:underline ml-1" aria-label={`${q.name} を削除`}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end pt-2 border-t border-diletto-gray/10">
        <div className="flex-1">
          <Label className="text-[10px] text-diletto-gray-light">資格名</Label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例: 保育士"
            className="h-9"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
        </div>
        <label className="flex items-center gap-1 h-9 text-xs text-diletto-gray cursor-pointer">
          <input
            type="checkbox"
            checked={newCountable}
            onChange={(e) => setNewCountable(e.target.checked)}
            className="h-4 w-4 accent-diletto-blue"
          />
          カウント対象
        </label>
        <Button type="button" size="sm" onClick={add} disabled={!newName.trim()} className="h-9">+ 追加</Button>
      </div>
    </div>
  );
}
