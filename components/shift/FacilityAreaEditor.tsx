'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { AreaLabel } from '@/lib/types';

interface Props {
  label: string;
  areas: AreaLabel[];
  onChange: (next: AreaLabel[]) => void;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// facility 共通エリア用。時刻（HH:MM）を含むエリア定義の追加・削除・並び替え。
export function FacilityAreaEditor({ label, areas, onChange }: Props) {
  const [newEmoji, setNewEmoji] = useState('');
  const [newName, setNewName] = useState('');
  const [newTime, setNewTime] = useState('');

  function addArea() {
    const name = newName.trim();
    if (!name) return;
    onChange([
      ...areas,
      { id: genId(), emoji: newEmoji.trim() || '📍', name, time: newTime || undefined },
    ]);
    setNewEmoji('');
    setNewName('');
    setNewTime('');
  }

  function removeArea(id: string) {
    onChange(areas.filter((a) => a.id !== id));
  }

  function updateArea(id: string, patch: Partial<AreaLabel>) {
    onChange(areas.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function moveArea(id: string, dir: -1 | 1) {
    const idx = areas.findIndex((a) => a.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= areas.length) return;
    const next = [...areas];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-3 rounded-md border border-brand-gray/10 p-4 bg-gray-50/50">
      <Label className="text-sm font-bold text-brand-ink">{label}</Label>

      {areas.length === 0 && (
        <p className="text-xs text-brand-gray-light py-2">まだエリアがありません。下のフォームから追加してください。</p>
      )}

      {areas.length > 0 && (
        <div className="space-y-1">
          {areas.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-brand-gray/10 bg-white px-2 py-2">
              <div className="inline-flex flex-col gap-0.5 shrink-0">
                <button type="button" disabled={i === 0} onClick={() => moveArea(a.id, -1)}
                  className="w-5 h-4 flex items-center justify-center rounded bg-white border border-brand-gray/15 text-brand-gray hover:bg-brand-beige disabled:opacity-30"
                  aria-label="上へ">▲</button>
                <button type="button" disabled={i === areas.length - 1} onClick={() => moveArea(a.id, 1)}
                  className="w-5 h-4 flex items-center justify-center rounded bg-white border border-brand-gray/15 text-brand-gray hover:bg-brand-beige disabled:opacity-30"
                  aria-label="下へ">▼</button>
              </div>
              <Input
                value={a.emoji}
                onChange={(e) => updateArea(a.id, { emoji: e.target.value })}
                maxLength={2}
                className="h-9 w-14 text-center"
                aria-label="絵文字"
              />
              <Input
                value={a.name}
                onChange={(e) => updateArea(a.id, { name: e.target.value })}
                className="h-9 flex-1"
                aria-label="エリア名"
              />
              <Input
                type="time"
                value={a.time ?? ''}
                onChange={(e) => updateArea(a.id, { time: e.target.value || undefined })}
                className="h-9 w-28"
                aria-label="標準時刻"
              />
              <button type="button" onClick={() => removeArea(a.id)}
                className="text-xs text-brand-red hover:underline shrink-0 px-1">削除</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end pt-2 border-t border-brand-gray/10">
        <div className="w-20">
          <Label className="text-[10px] text-brand-gray-light">絵文字</Label>
          <Input value={newEmoji} onChange={(e) => setNewEmoji(e.target.value)} placeholder="🏠" maxLength={2} className="h-9 text-center" />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] text-brand-gray-light">エリア名</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: 藤江エリア" className="h-9"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } }}
          />
        </div>
        <div className="w-28">
          <Label className="text-[10px] text-brand-gray-light">標準時刻</Label>
          <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-9" />
        </div>
        <Button type="button" size="sm" onClick={addArea} disabled={!newName.trim()} className="h-9">+ 追加</Button>
      </div>
    </div>
  );
}
