'use client';

/**
 * 保有資格 自由入力（タグ式）— Phase 66+ / migration 129
 *
 * 用途: 個人が持つ資格（介護福祉士、英検、普通自動車免許 等）を自由に追加・削除する。
 * シフト・送迎の有資格者判定で使う「事業所マスタ連動の資格」とは別概念。
 * employees.qualifications text[] に保存される。
 *
 * 操作:
 * - テキスト入力 + Enter または「追加」ボタンで配列に push
 * - 各タグの「×」で削除
 * - 重複は無視（同一文字列は追加されない）
 */

import { useState } from 'react';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** disabled 状態（読み取り専用化）。デフォルト false */
  disabled?: boolean;
  /** タグ表示エリアの空状態の文言 */
  emptyHint?: string;
  placeholder?: string;
}

export default function QualificationsInput({
  value,
  onChange,
  disabled = false,
  emptyHint = '資格を追加してください',
  placeholder = '例) 介護福祉士、普通自動車免許、英検2級',
}: Props) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...value, v]);
    setDraft('');
  };

  const remove = (q: string) => {
    onChange(value.filter((x) => x !== q));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* タグ表示 */}
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {value.length === 0 ? (
          <span className="text-xs px-1" style={{ color: 'var(--ink-3, #9ca3af)' }}>
            {emptyHint}
          </span>
        ) : (
          value.map((q) => (
            <span
              key={q}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border"
              style={{
                background: 'var(--accent-pale, #e8ecf7)',
                color: 'var(--ink, #1f2937)',
                borderColor: 'var(--rule, #d8d8d4)',
              }}
            >
              {q}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(q)}
                  aria-label={`${q} を削除`}
                  className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-white"
                  style={{ color: 'var(--ink-3, #6b7280)' }}
                >
                  ×
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {/* 追加 input */}
      {!disabled && (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 outline-none text-sm rounded px-3 py-1.5"
            style={{
              background: 'var(--white, #ffffff)',
              border: '1px solid var(--rule, #d8d8d4)',
              color: 'var(--ink, #1f2937)',
            }}
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="text-xs font-semibold px-3 py-1.5 rounded transition-colors disabled:opacity-40"
            style={{
              background: 'var(--accent, #1a3eb8)',
              color: '#fff',
              border: '1px solid var(--accent, #1a3eb8)',
            }}
          >
            追加
          </button>
        </div>
      )}
    </div>
  );
}
