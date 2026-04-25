'use client';

// shift-puzzle の Button API そのまま（primary / secondary / cta-submit / app-card-cta）
import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'cta-submit' | 'app-card-cta';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: 'var(--accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 24px',
  },
  secondary: {
    background: 'var(--white)',
    color: 'var(--ink-2)',
    border: '1px solid var(--rule-strong)',
    borderRadius: '4px',
    padding: '10px 24px',
  },
  'cta-submit': {
    background: 'var(--white)',
    color: 'var(--ink)',
    border: '1px solid var(--rule)',
    borderRadius: '4px',
    padding: '12px 24px',
    width: '100%',
  },
  'app-card-cta': {
    background: 'transparent',
    color: 'var(--accent)',
    border: '1.5px solid var(--accent)',
    borderRadius: '5px',
    padding: '8px 20px',
  },
};

export default function Button({
  variant = 'primary',
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`text-sm font-semibold whitespace-nowrap transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${className}`}
      style={variantStyles[variant]}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
