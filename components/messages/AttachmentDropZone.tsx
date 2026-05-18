'use client';

/* 176: 個別連絡の添付ファイル選択 UI。
   - クリック で従来通りファイル選択ダイアログ
   - ドラッグ&ドロップで直接ファイル受け付け
   - ペースト (Ctrl+V) でクリップボード画像受け付け
   - 受け入れ MIME / サイズ判定は呼び出し側で */

import { useRef, useState } from 'react';

interface Props {
  onFiles: (files: FileList | File[]) => void;
  acceptMime: string;
  maxBytesLabel: string;
  helperText?: string;
  compact?: boolean;
}

export function AttachmentDropZone({ onFiles, acceptMime, maxBytesLabel, helperText, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleClick() {
    inputRef.current?.click();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
    if (files.length > 0) {
      e.preventDefault();
      onFiles(files);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
      className={
        `cursor-pointer rounded-md border-2 border-dashed transition-colors text-center select-none ` +
        (compact ? 'p-2 ' : 'p-4 ') +
        (dragOver
          ? 'border-brand-blue bg-brand-blue/[0.06] text-brand-blue'
          : 'border-brand-gray/30 text-brand-gray hover:border-brand-blue/50 hover:bg-brand-blue/[0.03] hover:text-brand-ink')
      }
    >
      <div className={compact ? 'text-xs flex items-center justify-center gap-2' : 'space-y-1'}>
        <span className={compact ? 'text-sm' : 'text-xl block'}>📎</span>
        <span className={compact ? '' : 'block text-sm font-medium'}>
          {dragOver ? 'ここに離してください' : (compact ? 'クリック または ドラッグ&ドロップ' : 'クリックして選択 または ここにドラッグ&ドロップ')}
        </span>
        {!compact && (
          <span className="block text-[11px] text-brand-gray-light">
            {helperText ?? `画像 / PDF、各 ${maxBytesLabel} まで`}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptMime}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
