'use client';

/**
 * 利用予定グリッド（shift-puzzle ScheduleGrid.tsx 忠実移植）
 * - 行: 児童名
 * - 列: 日付（1日〜末日）
 * - セル: 迎/送 時間表示 + メソッド（自/迎/送）+ 出欠状態
 * - 最下行: 利用人数合計
 * - sticky ヘッダー/左列、今日列ハイライト + 自動スクロール
 */

import React, { useEffect, useRef } from 'react';
import { format, getDaysInMonth, getDay } from 'date-fns';
import type { AttendanceStatus } from '@/lib/types';
import { isAttended, isWaitlist } from '@/lib/logic/attendance';

type ScheduleChild = {
  id: string;
  name: string;
  grade_label: string;
};

export type ScheduleCellData = {
  child_id: string;
  date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  pickup_method: 'self' | 'pickup';
  dropoff_method: 'self' | 'dropoff';
  note: string | null;
  entry_id?: string | null;
  attendance_status?: AttendanceStatus;
  /** Phase 64: キャンセル待ちの順番 (1〜10)。waitlist 以外は null。 */
  waitlist_order?: number | null;
};

const WAITLIST_MARKS = '①②③④⑤⑥⑦⑧⑨⑩';

interface Props {
  year: number;
  month: number;
  children: ScheduleChild[];
  cells: ScheduleCellData[];
  onCellClick: (childId: string, date: string) => void;
}

const DOW_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

function formatHM(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return raw;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export default function ScheduleGridFull({
  year,
  month,
  children,
  cells,
  onCellClick,
}: Props) {
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const dates: { day: number; dow: number; dateStr: string }[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    dates.push({
      day: d,
      dow: getDay(dateObj),
      dateStr: format(dateObj, 'yyyy-MM-dd'),
    });
  }

  const cellMap = new Map<string, ScheduleCellData>();
  cells.forEach((c) => {
    cellMap.set(`${c.child_id}_${c.date}`, c);
  });

  /* 出席判定は lib/logic/attendance.ts の isAttended / isWaitlist に一元化
     （CLAUDE.md §10「deaf-ic 出席判定（一元化・Phase 66-E 以降）」）。
     ScheduleCellData は pickup_time/dropoff_time/attendance_status を持つので
     そのまま渡せる（AttendanceCheckable と構造的に互換）。 */
  const toCheckable = (cell: ScheduleCellData) => ({
    pickup_time: cell.pickup_time,
    dropoff_time: cell.dropoff_time,
    attendance_status: cell.attendance_status ?? null,
  });

  const dailyCounts = new Map<string, number>();
  /* Phase 64: 日別キャンセル待ち件数（同日内重複可、cell 単位カウント） */
  const dailyWaitlistCounts = new Map<string, number>();
  /* 児童ごとの月間出席日数・待機日数（氏名列に「出席Nd / 待機Md」で表示） */
  const childAttendedDays = new Map<string, number>();
  const childWaitlistDays = new Map<string, number>();

  dates.forEach((d) => {
    let count = 0;
    let waitlistCount = 0;
    children.forEach((child) => {
      const cell = cellMap.get(`${child.id}_${d.dateStr}`);
      if (!cell) return;
      const checkable = toCheckable(cell);
      if (isWaitlist(checkable)) {
        waitlistCount++;
        childWaitlistDays.set(child.id, (childWaitlistDays.get(child.id) ?? 0) + 1);
        return;
      }
      if (isAttended(checkable)) {
        count++;
        childAttendedDays.set(child.id, (childAttendedDays.get(child.id) ?? 0) + 1);
      }
    });
    dailyCounts.set(d.dateStr, count);
    dailyWaitlistCounts.set(d.dateStr, waitlistCount);
  });
  const hasAnyWaitlist = Array.from(dailyWaitlistCounts.values()).some((n) => n > 0);

  const today = todayStr();
  const todayInMonth = dates.some((d) => d.dateStr === today);
  const todayHeaderRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    if (!todayInMonth) return;
    todayHeaderRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [todayInMonth, today]);

  const getDowStyle = (dow: number): React.CSSProperties => {
    if (dow === 0) return { color: 'var(--red)', background: 'rgba(155,51,51,0.04)' };
    if (dow === 6) return { color: 'var(--accent)', background: 'rgba(26,62,184,0.04)' };
    return {};
  };

  const getCellBg = (dow: number): string => {
    if (dow === 0) return 'rgba(155,51,51,0.03)';
    if (dow === 6) return 'rgba(26,62,184,0.03)';
    return 'transparent';
  };

  const getStickyBg = (dow: number): string => {
    const tint = getCellBg(dow);
    if (tint === 'transparent') return 'var(--bg)';
    return `linear-gradient(${tint}, ${tint}), var(--bg)`;
  };

  return (
    <div className="flex-1 overflow-auto border-2 rounded-xl" style={{ borderColor: 'var(--rule)', background: 'var(--white)' }}>
      <table
        className="w-full border-separate border-spacing-0"
        style={{ minWidth: `${dates.length * 80 + 160}px`, fontSize: '0.85rem' }}
      >
        <thead>
          <tr>
            <th
              className="schedule-grid-sticky-corner sticky left-0 top-0 z-50 px-4 py-4 text-left font-bold"
              style={{
                borderBottom: '2px solid var(--rule-strong)',
                borderRight: '2px solid var(--rule-strong)',
                minWidth: '160px',
                color: 'var(--ink)',
                boxShadow: '4px 4px 10px rgba(0,0,0,0.03)',
              }}
            >
              氏名
            </th>
            {dates.map((d) => {
              const isTodayCol = d.dateStr === today;
              return (
                <th
                  key={d.dateStr}
                  ref={isTodayCol ? todayHeaderRef : undefined}
                  className="sticky top-0 z-30 px-1 py-1.5 text-center font-bold whitespace-nowrap"
                  style={{
                    borderBottom: '2px solid var(--rule-strong)',
                    borderRight: isTodayCol ? '2px solid var(--accent)' : '1px solid var(--rule)',
                    borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                    minWidth: '80px',
                    ...getDowStyle(d.dow),
                    background: isTodayCol ? 'var(--accent-pale)' : getStickyBg(d.dow),
                    color: isTodayCol ? 'var(--accent)' : undefined,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                  }}
                  title={isTodayCol ? '今日' : undefined}
                >
                  <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '2px' }}>
                    {d.dow === 0 || d.dow === 6 ? '休' : '営'}
                  </div>
                  <div style={{ fontSize: '0.85rem' }}>
                    {month}/{d.day}
                  </div>
                  <div style={{ fontSize: '0.65rem' }}>
                    ({DOW_SHORT[d.dow]})
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {children.map((child) => (
            <tr key={child.id} className="group cursor-pointer transition-colors">
              <td
                className="schedule-grid-sticky-child sticky left-0 z-30 px-4 py-3 font-semibold whitespace-nowrap"
                style={{
                  borderBottom: '1px solid var(--rule)',
                  borderRight: '2px solid var(--rule-strong)',
                  color: 'var(--ink)',
                  boxShadow: '4px 0 6px rgba(0,0,0,0.02)',
                }}
              >
                <div className="group-hover:text-[var(--accent)] transition-colors">{child.name}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', marginTop: '2px' }}>{child.grade_label}</div>
                {(() => {
                  const a = childAttendedDays.get(child.id) ?? 0;
                  const w = childWaitlistDays.get(child.id) ?? 0;
                  if (a === 0 && w === 0) return null;
                  return (
                    <div
                      style={{ fontSize: '0.68rem', marginTop: '2px', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}
                      title={`今月: 出席 ${a} 日 / 待機 ${w} 日`}
                    >
                      {a > 0 && <span style={{ color: 'var(--green)', fontWeight: 600 }}>出{a}</span>}
                      {a > 0 && w > 0 && <span style={{ color: 'var(--ink-3)', margin: '0 3px' }}>/</span>}
                      {w > 0 && <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>待{w}</span>}
                    </div>
                  );
                })()}
              </td>
              {dates.map((d) => {
                const cell = cellMap.get(`${child.id}_${d.dateStr}`);
                const hasTimes = !!(cell && (cell.pickup_time || cell.dropoff_time));
                const hasEntry = !!cell && (cell.entry_id ?? null) !== null;
                const isAbsent = cell?.attendance_status === 'absent';
                const isLeave = cell?.attendance_status === 'leave';
                const isWaitlist = cell?.attendance_status === 'waitlist';
                const isOff = isLeave || (hasEntry && !hasTimes && !isAbsent && !isWaitlist);

                let bg = getCellBg(d.dow);
                if (isAbsent) bg = 'var(--red-pale)';
                else if (isWaitlist) bg = 'rgba(0,0,0,0.06)';
                else if (isOff) bg = 'rgba(0,0,0,0.04)';

                const isTodayCol = d.dateStr === today;

                return (
                  <td
                    key={d.dateStr}
                    className="px-1 py-1 text-center transition-colors cursor-pointer group-hover:!bg-[var(--accent-pale)]"
                    style={{
                      borderBottom: '1px solid var(--rule)',
                      borderRight: isTodayCol ? '2px solid var(--accent)' : '1px solid var(--rule)',
                      borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                      background: bg,
                    }}
                    onClick={() => onCellClick(child.id, d.dateStr)}
                    title={
                      isAbsent ? '欠席' : isWaitlist ? 'キャンセル待ち' : isOff ? 'お休み' : hasTimes ? '出席' : '未入力（クリックで編集）'
                    }
                  >
                    {cell?.note ? (
                      <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                        {cell.note}
                      </span>
                    ) : isAbsent ? (
                      <span className="text-xs font-bold" style={{ color: 'var(--red)' }}>欠席</span>
                    ) : isWaitlist ? (
                      <div
                        className="flex flex-col gap-0 leading-tight"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        <span className="text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
                          キャ待{cell?.waitlist_order ? ` ${WAITLIST_MARKS.charAt(cell.waitlist_order - 1)}` : ''}
                        </span>
                        {cell?.pickup_time && (
                          <span style={{ color: 'var(--ink-3)', fontSize: '0.68rem' }}>
                            {formatHM(cell.pickup_time)}
                          </span>
                        )}
                        {cell?.dropoff_time && (
                          <span style={{ color: 'var(--ink-3)', fontSize: '0.68rem' }}>
                            {formatHM(cell.dropoff_time)}
                          </span>
                        )}
                      </div>
                    ) : isOff ? (
                      <span className="text-xs font-bold" style={{ color: 'var(--ink-3)' }}>お休み</span>
                    ) : hasTimes ? (
                      <div className="flex flex-col gap-0 leading-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {cell?.pickup_time && (
                          cell.pickup_method === 'self' ? (
                            <span style={{ color: 'var(--ink-3)', fontSize: '0.72rem' }}>
                              自 {formatHM(cell.pickup_time)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--accent)', fontSize: '0.72rem' }}>
                              迎 {formatHM(cell.pickup_time)}
                            </span>
                          )
                        )}
                        {cell?.dropoff_time && (
                          cell.dropoff_method === 'self' ? (
                            <span style={{ color: 'var(--ink-3)', fontSize: '0.72rem' }}>
                              自 {formatHM(cell.dropoff_time)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--green)', fontSize: '0.72rem' }}>
                              送 {formatHM(cell.dropoff_time)}
                            </span>
                          )
                        )}
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--ink-3)', opacity: 0.5 }}>−</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}

          <tr>
            <td
              className="schedule-grid-sticky-corner sticky left-0 bottom-0 z-50 px-4 py-3 font-bold"
              style={{
                borderTop: '2px solid var(--rule-strong)',
                borderRight: '2px solid var(--rule-strong)',
                color: 'var(--ink)',
                boxShadow: '4px -4px 6px rgba(0,0,0,0.02)',
              }}
            >
              利用数
            </td>
            {dates.map((d) => {
              const count = dailyCounts.get(d.dateStr) || 0;
              const isTodayCol = d.dateStr === today;
              return (
                <td
                  key={d.dateStr}
                  className="sticky bottom-0 z-40 px-1 py-2 text-center font-bold"
                  style={{
                    borderTop: '2px solid var(--rule-strong)',
                    borderRight: isTodayCol ? '2px solid var(--accent)' : '1px solid var(--rule)',
                    borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                    color: count > 10 ? 'var(--red)' : count > 0 ? 'var(--green)' : 'var(--ink-3)',
                    fontWeight: count > 10 ? 800 : 700,
                    background: isTodayCol ? 'var(--accent-pale)' : getStickyBg(d.dow),
                    boxShadow: '0 -4px 4px rgba(0,0,0,0.02)',
                  }}
                >
                  {count > 0 ? count : ''}
                </td>
              );
            })}
          </tr>

          {/* Phase 64: 月内に1件でも waitlist があれば、利用数行の下にキャンセル待ち件数行 */}
          {hasAnyWaitlist && (
            <tr>
              <td
                className="schedule-grid-sticky-corner sticky left-0 bottom-0 z-50 px-4 py-2 font-bold whitespace-nowrap"
                style={{
                  borderTop: '1px dashed var(--rule-strong)',
                  borderRight: '2px solid var(--rule-strong)',
                  color: 'var(--ink-2)',
                  fontSize: '0.78rem',
                  background: 'var(--bg)',
                }}
              >
                キャンセル待ち
              </td>
              {dates.map((d) => {
                const wcount = dailyWaitlistCounts.get(d.dateStr) || 0;
                const isTodayCol = d.dateStr === today;
                return (
                  <td
                    key={d.dateStr}
                    className="sticky bottom-0 z-40 px-1 py-2 text-center font-bold"
                    style={{
                      borderTop: '1px dashed var(--rule-strong)',
                      borderRight: isTodayCol ? '2px solid var(--accent)' : '1px solid var(--rule)',
                      borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                      color: wcount > 0 ? 'var(--ink-2)' : 'var(--ink-3)',
                      fontSize: '0.78rem',
                      background: isTodayCol ? 'var(--accent-pale)' : getStickyBg(d.dow),
                    }}
                  >
                    {wcount > 0 ? wcount : ''}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
