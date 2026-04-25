'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MAX_PDF_FILE_SIZE_MB } from '@/lib/constants';

interface Props {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export function PdfTemplateUploader({ onFileSelected, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(file: File): boolean {
    setError(null);

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('PDFファイルのみアップロードできます');
      return false;
    }

    if (file.size > MAX_PDF_FILE_SIZE_MB * 1024 * 1024) {
      setError(`ファイルサイズは${MAX_PDF_FILE_SIZE_MB}MB以下にしてください`);
      return false;
    }

    return true;
  }

  function handleFile(file: File) {
    if (validate(file)) {
      onFileSelected(file);
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={`
          relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors
          ${dragOver ? 'border-diletto-blue bg-diletto-blue/5' : 'border-diletto-gray/30'}
          ${disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-diletto-blue/50'}
        `}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-diletto-gray mb-3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="12" y2="12" />
          <line x1="15" y1="15" x2="12" y2="12" />
        </svg>
        <p className="text-sm font-medium">PDFファイルをドラッグ&ドロップ</p>
        <p className="text-xs text-diletto-gray mt-1">
          またはクリックして選択（{MAX_PDF_FILE_SIZE_MB}MBまで）
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p className="text-sm text-diletto-red">{error}</p>
      )}
    </div>
  );
}
