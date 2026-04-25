'use client';

// shift-puzzle の Modal API そのまま（size: sm/md/lg/xl、title + onClose）
// shadcn Dialog ではなく手書き版を採用（原本の見た目を維持）

import { type ReactNode, useEffect } from 'react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: ModalSize;
};

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export default function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.4)' }}
      onClick={onClose}
    >
      <div
        className={`w-full ${SIZE_CLASSES[size]} mx-4 max-h-[85vh] overflow-y-auto`}
        style={{
          background: 'var(--white)',
          borderRadius: '8px',
          boxShadow: '0 20px 48px rgba(0,0,0,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 sticky top-0 z-10"
          style={{ borderBottom: '1px solid var(--rule)', background: 'var(--white)' }}
        >
          <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none hover:opacity-60 transition-opacity"
            style={{ color: 'var(--ink-3)' }}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
