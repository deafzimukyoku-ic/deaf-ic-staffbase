'use client';

import { useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  getDay,
  getDaysInMonth,
  isSameDay,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { todayStr } from '@/lib/date/isToday';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';
import DatePopover, { type DayState as PopoverDayState } from '@/components/shift/DatePopover';

/**
 * 日付ステッパ（shift-puzzle DateStepper の deaf-ic 移植）
 * フォーマット: ⟪前月  ⟨前日  [年月日（曜日）📅]  翌日⟩  翌月⟫  [今日へ]
 *
 * 差分:
 * - useCurrentStaff / isDateOutOfRange への依存を削除（deaf-ic は employee 側 RLS）
 * - 日付ボタンクリックで自前カレンダー (DatePopover) を表示（編集中/保存済/未割当ドット付き）
 */

export type DayState = PopoverDayState;

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  dayStates?: Map<string, DayState>;
};

function toDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export default function DateStepperFull({ value, onChange, dayStates }: Props) {
  const today = todayStr();
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(value) ? toDate(value) : new Date();
  const label = format(dt, 'yyyy年M月d日（E）', { locale: ja });
  const isToday = value === today;
  const dow = getDay(dt);
  const holiday = isJpHoliday(value);
  const holidayName = holiday ? jpHolidayName(value) : null;
  const labelColor =
    holiday || dow === 0 ? 'var(--red, #d4625a)' : dow === 6 ? 'var(--accent, #4a7fb6)' : 'var(--ink, #1f2937)';

  const dateButtonRef = useRef<HTMLButtonElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const goPrevDay = () => onChange(toStr(subDays(dt, 1)));
  const goNextDay = () => onChange(toStr(addDays(dt, 1)));
  const goPrevMonth = () => {
    const prev = subMonths(dt, 1);
    const clip = Math.min(dt.getDate(), getDaysInMonth(prev));
    onChange(toStr(new Date(prev.getFullYear(), prev.getMonth(), clip)));
  };
  const goNextMonth = () => {
    const next = addMonths(dt, 1);
    const clip = Math.min(dt.getDate(), getDaysInMonth(next));
    onChange(toStr(new Date(next.getFullYear(), next.getMonth(), clip)));
  };
  const goToday = () => onChange(today);

  const btnBase: React.CSSProperties = {
    background: 'var(--white, #ffffff)',
    color: 'var(--ink-2, #4a4a4a)',
    border: '1px solid var(--rule, #d8d8d4)',
    borderRadius: '6px',
  };
  const chevronBtn =
    'w-9 h-9 inline-flex items-center justify-center text-base font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

  const firstOfMonth = startOfMonth(dt);
  const lastOfMonth = endOfMonth(dt);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* ナビゲーション本体: « ‹ [日付] › » を 1 グループにまとめて折り返さない */}
      <div className="inline-flex items-center gap-1 flex-nowrap">
        <button
          type="button"
          onClick={goPrevMonth}
          className={chevronBtn}
          style={btnBase}
          aria-label="前の月"
          title="前の月"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-pale, #e7eef7)';
            e.currentTarget.style.color = 'var(--accent, #4a7fb6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--white, #ffffff)';
            e.currentTarget.style.color = 'var(--ink-2, #4a4a4a)';
          }}
        >
          ⟪
        </button>
        <button
          type="button"
          onClick={goPrevDay}
          className={chevronBtn}
          style={btnBase}
          aria-label="前の日"
          title={isSameDay(dt, firstOfMonth) ? '前月末日へ' : '前の日'}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-pale, #e7eef7)';
            e.currentTarget.style.color = 'var(--accent, #4a7fb6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--white, #ffffff)';
            e.currentTarget.style.color = 'var(--ink-2, #4a4a4a)';
          }}
        >
          ‹
        </button>

        {/* 中央の日付ボタン + 📅。クリックでカスタムカレンダー (DatePopover) を表示。 */}
        <div className="relative inline-flex">
          <button
            ref={dateButtonRef}
            type="button"
            onClick={() => setPopoverOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 font-bold transition-all whitespace-nowrap"
            style={{
              color: labelColor,
              background: 'var(--white, #ffffff)',
              border: '1.5px solid var(--accent, #4a7fb6)',
              borderRadius: '8px',
              padding: '6px 10px',
              fontSize: '0.9rem',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent-pale, #e7eef7)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--white, #ffffff)';
            }}
            aria-expanded={popoverOpen}
            aria-haspopup="dialog"
            title={holidayName ? `祝日: ${holidayName}` : 'カレンダーを開く'}
          >
            <span>{label}</span>
            {holidayName && (
              <span
                className="text-xs font-semibold"
                style={{ color: 'var(--red, #d4625a)', opacity: 0.9 }}
              >
                {holidayName}
              </span>
            )}
            {isToday && (
              <span
                aria-hidden
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--accent, #4a7fb6)',
                  boxShadow: '0 0 0 2px var(--accent-pale, #e7eef7)',
                }}
              />
            )}
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>📅</span>
          </button>
          <DatePopover
            open={popoverOpen}
            value={value}
            onChange={(v) => {
              onChange(v);
              setPopoverOpen(false);
            }}
            onClose={() => setPopoverOpen(false)}
            dayStates={dayStates}
            anchorRef={dateButtonRef}
          />
        </div>

        <button
          type="button"
          onClick={goNextDay}
          className={chevronBtn}
          style={btnBase}
          aria-label="次の日"
          title={isSameDay(dt, lastOfMonth) ? '翌月1日へ' : '次の日'}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-pale, #e7eef7)';
            e.currentTarget.style.color = 'var(--accent, #4a7fb6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--white, #ffffff)';
            e.currentTarget.style.color = 'var(--ink-2, #4a4a4a)';
          }}
        >
          ›
        </button>
        <button
          type="button"
          onClick={goNextMonth}
          className={chevronBtn}
          style={btnBase}
          aria-label="次の月"
          title="次の月"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-pale, #e7eef7)';
            e.currentTarget.style.color = 'var(--accent, #4a7fb6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--white, #ffffff)';
            e.currentTarget.style.color = 'var(--ink-2, #4a4a4a)';
          }}
        >
          ⟫
        </button>
      </div>

      {!isToday && (
        <button
          type="button"
          onClick={goToday}
          className="text-xs font-semibold px-3 py-2 rounded transition-colors whitespace-nowrap"
          style={{
            background: 'transparent',
            color: 'var(--accent, #4a7fb6)',
            border: '1px solid var(--accent, #4a7fb6)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-pale, #e7eef7)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          title="今日の日付にジャンプ"
        >
          今日へ
        </button>
      )}
    </div>
  );
}

