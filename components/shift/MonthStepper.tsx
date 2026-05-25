'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { addMonths, format, subMonths } from 'date-fns';

/**
 * 月ステッパ: ⟨前月 [2026年4月] 翌月⟩ + 「今月へ」
 * 移植元: diletto-shift-maker/src/components/ui/MonthStepper.tsx
 *
 * URL ?month=YYYY-MM を唯一の真実として扱う。
 */

function thisMonthStr(): string {
  return format(new Date(), 'yyyy-MM');
}

const STORAGE_KEY = 'deaf-ic.shift.current-month';

interface MonthStepperProps {
  showYearJump?: boolean;
  defaultMonth?: string;
  /* 月送り範囲制限 (任意)。'YYYY-MM' 形式。
     facility-shift-month-navigation 仕様で MyFacilityShiftView に ±1 ヶ月制限を入れるため追加。
     未指定なら無制限 (ShiftFull / MyRequestsView は従来通り)。 */
  minMonth?: string;
  maxMonth?: string;
}

export default function MonthStepper({ showYearJump = false, defaultMonth, minMonth, maxMonth }: MonthStepperProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlMonth = searchParams.get('month');
  const isValid = urlMonth && /^\d{4}-\d{2}$/.test(urlMonth);
  const thisMonth = thisMonthStr();
  const current = isValid ? urlMonth : (defaultMonth || thisMonth);
  const isCurrentMonth = current === thisMonth;
  /* 範囲端の判定 (props 未指定時は false 固定 = 制限なし) */
  const atMin = !!minMonth && current <= minMonth;
  const atMax = !!maxMonth && current >= maxMonth;
  /* 「今月へ」ジャンプは今月が範囲内のときのみ有効 */
  const todayInRange = (!minMonth || thisMonth >= minMonth) && (!maxMonth || thisMonth <= maxMonth);

  const setMonth = (next: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* noop */
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', next);
    params.delete('date');
    router.push(`${pathname}?${params.toString()}`);
  };

  const shift = (ym: string, delta: number): string => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    const next = delta > 0 ? addMonths(d, delta) : subMonths(d, -delta);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  };

  const [y, m] = current.split('-').map(Number);

  const btnBase: React.CSSProperties = {
    background: 'var(--white)',
    color: 'var(--ink-2)',
    border: '1px solid var(--rule)',
    borderRadius: '6px',
  };
  const chevronBtn = 'w-8 h-8 inline-flex items-center justify-center text-sm font-semibold transition-colors';

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap" role="group" aria-label="対象月">
      <div className="inline-flex items-center gap-1">
        {showYearJump && (
          <button
            type="button"
            onClick={() => setMonth(shift(current, -12))}
            disabled={atMin}
            className={chevronBtn}
            style={atMin ? { ...btnBase, opacity: 0.35, cursor: 'not-allowed' } : btnBase}
            aria-label="前の年"
            title="前の年"
          >
            ⟪
          </button>
        )}
        <button
          type="button"
          onClick={() => setMonth(shift(current, -1))}
          disabled={atMin}
          className={chevronBtn}
          style={atMin ? { ...btnBase, opacity: 0.35, cursor: 'not-allowed' } : btnBase}
          aria-label="前の月"
          title="前の月"
        >
          ‹
        </button>
      </div>

      <div
        className="inline-flex items-center gap-2 font-bold"
        style={{
          color: 'var(--ink)',
          background: 'var(--white)',
          border: '1.5px solid var(--accent)',
          borderRadius: '8px',
          padding: '6px 12px',
          fontSize: '0.95rem',
          minWidth: '110px',
          justifyContent: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <span>{y}年{m}月</span>
        {isCurrentMonth && (
          <span
            aria-hidden
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 0 2px var(--accent-pale)',
            }}
          />
        )}
      </div>

      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMonth(shift(current, 1))}
          disabled={atMax}
          className={chevronBtn}
          style={atMax ? { ...btnBase, opacity: 0.35, cursor: 'not-allowed' } : btnBase}
          aria-label="次の月"
          title="次の月"
        >
          ›
        </button>
        {showYearJump && (
          <button
            type="button"
            onClick={() => setMonth(shift(current, 12))}
            disabled={atMax}
            className={chevronBtn}
            style={atMax ? { ...btnBase, opacity: 0.35, cursor: 'not-allowed' } : btnBase}
            aria-label="次の年"
            title="次の年"
          >
            ⟫
          </button>
        )}
      </div>

      {!isCurrentMonth && todayInRange && (
        <button
          type="button"
          onClick={() => setMonth(thisMonth)}
          className="text-xs font-semibold px-2.5 py-1.5 rounded transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
          }}
          title="今月にジャンプ"
        >
          今月へ
        </button>
      )}
    </div>
  );
}
