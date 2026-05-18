'use client';

/**
 * PDF ページナビゲーター
 * ページ送り + ページ番号表示
 */

interface Props {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function PdfPageNavigator({ currentPage, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-2 px-4 h-[36px] border-b border-brand-gray/10 bg-white shrink-0">
      <button
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-brand-gray/20 bg-white text-xs text-brand-gray hover:bg-brand-bg disabled:opacity-30 transition-all"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span className="text-xs text-brand-gray font-medium min-w-[60px] text-center">
        {currentPage} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-brand-gray/20 bg-white text-xs text-brand-gray hover:bg-brand-bg disabled:opacity-30 transition-all"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
