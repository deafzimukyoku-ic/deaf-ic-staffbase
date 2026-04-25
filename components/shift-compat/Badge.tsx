// shift-puzzle の Badge API そのまま（success/warning/error/info/neutral）
import React, { type ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

type BadgeProps = {
  variant?: BadgeVariant;
  children: ReactNode;
};

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  success: { background: 'var(--green-pale)', color: 'var(--green)' },
  warning: { background: 'var(--gold-pale)', color: 'var(--gold)' },
  error: { background: 'var(--red-pale)', color: 'var(--red)' },
  info: { background: 'var(--accent-pale)', color: 'var(--accent)' },
  neutral: { background: 'rgba(0, 0, 0, 0.05)', color: 'var(--ink-3)' },
};

export default function Badge({ variant = 'neutral', children }: BadgeProps) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 text-xs font-semibold"
      style={{ ...variantStyles[variant], borderRadius: '4px' }}
    >
      {children}
    </span>
  );
}
