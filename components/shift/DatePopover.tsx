'use client';

/**
 * 日付ポップオーバー（カスタムカレンダー）
 *
 * 本家 shift-puzzle の DatePopover を deaf-ic 向けに移植したもの。
 * - native <input type="date"> の代替。PC ブラウザでも確実に開く
 * - 編集中(gold) / 保存済(accent) / 未割当(red) のドット表示（dayStates 渡された時のみ）
 * - 祝日 + 土日色分け、今日へジャンプ
 *
 * 本家からの差分:
 * - useCurrentStaff / isDateOutOfRange への依存削除（deaf-ic はロール体系が違うため、
 *   ここでは日付範囲制限を行わない。必要になったら別途 disable prop を追加する）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addMonths, getDay, getDaysInMonth, startOfMonth, subMonths } from 'date-fns';
import { todayStr } from '@/lib/date/isToday';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';

export type DayState = {
  locked?: boolean;
  unassigned?: boolean;
  /** 未保存編集あり。locked と同時に true でもこちらを優先表示（編集中は保存済を隠す） */
  editing?: boolean;
};

type Props = {
  open: boolean;
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  onClose: () => void;
  dayStates?: Map<string, DayState>;
  /** 表示月を value と独立に切替可能にするか。false なら value の月だけ */
  allowMonthBrowse?: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
};

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function DatePopover({
  open,
  value,
  onChange,
  onClose,
  dayStates,
  allowMonthBrowse = true,
  anchorRef,
}: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [viewYm, setViewYm] = useState<{ year: number; month: number }>(() => {
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value) : new Date();
    return { year: dt.getFullYear(), month: dt.getMonth() + 1 };
  });
  /* portal レンダリング用に document.body の存在を待つ（SSR 回避） */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  /* アンカー要素の画面座標（fixed 配置 + 画面端の自動クリップ）。
     overflow:hidden を持つ親内に置いてもクリップされないよう createPortal で body に描く。 */
  const POPOVER_W = 300;
  const POPOVER_H = 360; /* 余白込みの概算高さ。実描画後に超えていても画面端で clamp する */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const margin = 4;
      let left = r.left;
      let top = r.bottom + margin;
      /* 右端はみ出し → 左寄せ補正 */
      if (left + POPOVER_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - POPOVER_W - 8);
      /* 下に入りきらない → アンカー上に表示 */
      if (top + POPOVER_H > window.innerHeight - 8 && r.top - POPOVER_H - margin >= 8) {
        top = r.top - POPOVER_H - margin;
      }
      setPos({ left, top });
    };
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open, anchorRef]);

  /* value が変わったら表示月を追従 */
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const [y, m] = value.split('-').map(Number);
    setViewYm({ year: y, month: m });
  }, [value]);

  /* クリック外 / Esc で閉じる */
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  const { year, month } = viewYm;
  const today = todayStr();

  const cells = useMemo(() => {
    const first = startOfMonth(new Date(year, month - 1, 1));
    const leadingBlanks = getDay(first);
    const daysInMonth = getDaysInMonth(first);
    const list: Array<{ day: number | null; date?: string; dow?: number }> = [];
    for (let i = 0; i < leadingBlanks; i++) list.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = keyOf(year, month, d);
      const dow = getDay(new Date(year, month - 1, d));
      list.push({ day: d, date, dow });
    }
    /* 末尾を 7 の倍数に */
    while (list.length % 7 !== 0) list.push({ day: null });
    return list;
  }, [year, month]);

  if (!open || !mounted || !pos) return null;

  const popoverNode = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="日付を選択"
      className="p-3 shadow-xl"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 1000,
        width: `${POPOVER_W}px`,
        background: 'var(--white)',
        border: '1px solid var(--rule)',
        borderRadius: '12px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
      }}
    >
      {/* 月ナビ */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => {
            if (!allowMonthBrowse) return;
            const d = subMonths(new Date(year, month - 1, 1), 1);
            setViewYm({ year: d.getFullYear(), month: d.getMonth() + 1 });
          }}
          disabled={!allowMonthBrowse}
          className="w-7 h-7 inline-flex items-center justify-center rounded transition-colors disabled:opacity-30"
          style={{ color: 'var(--ink-2)' }}
          aria-label="前の月"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-pale)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          ‹
        </button>
        <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          {year}年{month}月
        </div>
        <button
          type="button"
          onClick={() => {
            if (!allowMonthBrowse) return;
            const d = addMonths(new Date(year, month - 1, 1), 1);
            setViewYm({ year: d.getFullYear(), month: d.getMonth() + 1 });
          }}
          disabled={!allowMonthBrowse}
          className="w-7 h-7 inline-flex items-center justify-center rounded transition-colors disabled:opacity-30"
          style={{ color: 'var(--ink-2)' }}
          aria-label="次の月"
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-pale)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          ›
        </button>
      </div>

      {/* 曜日ヘッダ */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DOW_LABELS.map((l, i) => (
          <div
            key={l}
            className="text-center text-xs font-semibold py-1"
            style={{ color: i === 0 ? 'var(--red)' : i === 6 ? 'var(--accent)' : 'var(--ink-3)' }}
          >
            {l}
          </div>
        ))}
      </div>

      {/* 日グリッド */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, idx) => {
          if (c.day == null) return <div key={idx} />;
          const isSelected = c.date === value;
          const isToday = c.date === today;
          const state = c.date ? dayStates?.get(c.date) : undefined;
          const holiday = c.date ? isJpHoliday(c.date) : false;
          const holidayName = holiday && c.date ? jpHolidayName(c.date) : null;

          const color = isSelected
            ? 'var(--white)'
            : holiday || c.dow === 0
            ? 'var(--red)'
            : c.dow === 6
            ? 'var(--accent)'
            : 'var(--ink)';

          return (
            <button
              key={idx}
              type="button"
              onClick={() => c.date && onChange(c.date)}
              className="relative h-9 w-full rounded-md text-sm font-medium transition-all"
              style={{
                background: isSelected ? 'var(--accent)' : 'transparent',
                color,
                border: isToday && !isSelected ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                fontWeight: isSelected || isToday ? 700 : 500,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'var(--accent-pale)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'transparent';
              }}
              aria-pressed={isSelected}
              aria-label={`${year}年${month}月${c.day}日${isToday ? '（今日）' : ''}${holidayName ? `（${holidayName}）` : ''}`}
              title={holidayName ?? undefined}
            >
              <span>{c.day}</span>
              {/* ドット: 編集中=gold / 保存済=accent / 未割当=red（編集中は保存済を上書き非表示） */}
              {(state?.editing || (state?.locked && !state?.editing) || state?.unassigned) && (
                <div
                  className="absolute flex items-center gap-0.5"
                  style={{ bottom: '3px', left: '50%', transform: 'translateX(-50%)' }}
                >
                  {state?.editing && (
                    <span
                      aria-hidden
                      style={{
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        background: isSelected ? 'var(--white)' : 'var(--gold, #d4a017)',
                      }}
                    />
                  )}
                  {state?.locked && !state?.editing && (
                    <span
                      aria-hidden
                      style={{
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        background: isSelected ? 'var(--white)' : 'var(--accent)',
                      }}
                    />
                  )}
                  {state?.unassigned && (
                    <span
                      aria-hidden
                      style={{
                        width: '4px',
                        height: '4px',
                        borderRadius: '50%',
                        background: isSelected ? 'var(--white)' : 'var(--red)',
                      }}
                    />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 凡例 + 今日へ */}
      <div
        className="mt-3 pt-2 flex items-center justify-between"
        style={{ borderTop: '1px solid var(--rule)', fontSize: '0.7rem', color: 'var(--ink-3)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {dayStates && dayStates.size > 0 && (
            <>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--gold, #d4a017)' }} />
                編集中
              </span>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--accent)' }} />
                保存済
              </span>
              <span className="inline-flex items-center gap-1">
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--red)' }} />
                未割当
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(today)}
          className="text-xs font-semibold px-2 py-1 rounded transition-colors"
          style={{ color: 'var(--accent)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-pale)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          今日へ
        </button>
      </div>
    </div>
  );

  return createPortal(popoverNode, document.body);
}
