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
import { jpHolidayName } from '@/lib/date/holidays';
import { isWeekendOrHoliday } from '@/lib/logic/inferDefaultTimes';

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
  /** migration 226: 日別メモ3行（利用表専用。シフト表とは別データ）。key=`${date}_${rowNo}` */
  dayNotes?: Map<string, string>;
  /** メモ編集の保存（blur 時）。未指定ならメモ行自体を描画しない */
  onDayNoteSave?: (date: string, rowNo: 1 | 2 | 3, text: string) => void;
  /** migration 226: メモ行の名称ラベル（施設×月×行番号）。key=row_no。未設定時は「メモN」表示 */
  dayNoteLabels?: Map<number, string>;
  /** メモ行名称の保存（blur 時）。 */
  onDayNoteLabelSave?: (rowNo: 1 | 2 | 3, text: string) => void;
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
  dayNotes,
  onDayNoteSave,
  dayNoteLabels,
  onDayNoteLabelSave,
}: Props) {
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  /* offDay = 学校が休み（土日 + 祝日）。「営 / 休」の表示と曜日色はこれで決める。
     セル編集モーダルの初期時刻推定（inferChildDefaultTimes）も同じ isWeekendOrHoliday を
     使っているため、ここを曜日だけで判定すると同じ画面の中で基準が食い違う
     （例: 2026-09-21 敬老の日 はヘッダ「営」なのに初期時刻は土日祝の 09:30 系）。 */
  const dates: { day: number; dow: number; dateStr: string; offDay: boolean; holidayName: string | null }[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dateStr = format(dateObj, 'yyyy-MM-dd');
    dates.push({
      day: d,
      dow: getDay(dateObj),
      dateStr,
      offDay: isWeekendOrHoliday(dateStr),
      holidayName: jpHolidayName(dateStr),
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

  /* 月合計（延べ数）。日別カウントの総和なので、判定基準は日別と完全に同じ
     （isAttended 準拠 = 送迎時刻あり かつ キャンセル待ちでない）。 */
  const monthlyTotal = Array.from(dailyCounts.values()).reduce((a, b) => a + b, 0);
  const monthlyWaitlistTotal = Array.from(dailyWaitlistCounts.values()).reduce((a, b) => a + b, 0);

  const today = todayStr();
  const todayInMonth = dates.some((d) => d.dateStr === today);
  const todayHeaderRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    if (!todayInMonth) return;
    todayHeaderRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [todayInMonth, today]);

  /* 祝日は日曜と同じ赤扱い。シフト表 ShiftGridFull の getDowColor と同一実装。
     土曜の祝日も赤になるが、休みであることを優先して示す。 */
  const getDowColor = (dow: number, isHoliday = false): string => {
    if (isHoliday || dow === 0) return 'var(--red)';
    if (dow === 6) return 'var(--accent)';
    return 'var(--ink-2)';
  };

  const getCellBg = (dow: number, isHoliday = false): string => {
    if (isHoliday || dow === 0) return 'rgba(155,51,51,0.03)';
    if (dow === 6) return 'rgba(26,62,184,0.03)';
    return 'transparent';
  };

  const getStickyBg = (dow: number, isHoliday = false): string => {
    const tint = getCellBg(dow, isHoliday);
    if (tint === 'transparent') return 'var(--bg)';
    return `linear-gradient(${tint}, ${tint}), var(--bg)`;
  };

  return (
    <div className="grid-scroll flex-1 overflow-auto border-2 rounded-xl" style={{ borderColor: 'var(--rule)', background: 'var(--white)' }}>
      <table
        className="w-full border-separate border-spacing-0"
        style={{ minWidth: `${dates.length * 56 + 180}px`, fontSize: '0.85rem' }}
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
                    minWidth: '56px',
                    background: isTodayCol ? 'var(--accent-pale)' : getStickyBg(d.dow, !!d.holidayName),
                    color: isTodayCol ? 'var(--accent)' : getDowColor(d.dow, !!d.holidayName),
                    boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                  }}
                  title={
                    [isTodayCol ? '今日' : null, d.holidayName, d.offDay ? '学校休み' : null]
                      .filter(Boolean)
                      .join('\n') || undefined
                  }
                >
                  {/* 構成はシフト表 ShiftGridFull の日付ヘッダに合わせる（曜日 / 日 / 人数）。
                      利用表だけ「営|休 / 9/2 / (水)」という別書式だったのを統一した
                      （先方指示 2026-09-08「シフトが正で利用表を合わせて」）。
                      学校が休みかどうかは曜日の色（日曜・祝日=赤 / 土曜=青）と title で示す。 */}
                  <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{DOW_SHORT[d.dow]}</div>
                  <div style={{ fontSize: '0.85rem' }}>{d.day}</div>
                  {(() => {
                    const count = dailyCounts.get(d.dateStr) ?? 0;
                    const waitlistCount = dailyWaitlistCounts.get(d.dateStr) ?? 0;
                    if (count === 0 && waitlistCount === 0) return null;
                    return (
                      <div style={{ fontSize: '0.6rem', color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1 }}>
                        {count > 0 && <span>{count}人</span>}
                        {waitlistCount > 0 && (
                          <span
                            style={{
                              marginLeft: count > 0 ? '3px' : '0',
                              color: 'var(--ink-2)',
                              fontWeight: 600,
                            }}
                            title={`キャンセル待ち ${waitlistCount} 名`}
                          >
                            待{waitlistCount}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* 日別メモ3行（migration 226）: 日付ヘッダと児童行の間。
              保存先は利用表専用の schedule_day_notes / schedule_day_note_labels で、
              シフト表のメモ（shift_day_notes）とは独立（先方指示 2026-09-08）。
              入力は非制御 (defaultValue + onBlur 保存) — 制御化すると 31日×3行の入力の
              たびにグリッド全体が再レンダされ重くなるため。key に保存値を含めて
              refetch 後の値変化時のみ remount して同期する。 */}
          {onDayNoteSave &&
            ([1, 2, 3] as const).map((rowNo) => {
              const isLastNote = rowNo === 3;
              const labelValue = dayNoteLabels?.get(rowNo) ?? '';
              return (
                <tr key={`day-note-${rowNo}`}>
                  <td
                    className="schedule-grid-sticky-child sticky left-0 z-30 px-2 py-1 whitespace-nowrap"
                    style={{
                      borderBottom: isLastNote ? '2px solid var(--rule-strong)' : '1px solid var(--rule)',
                      borderRight: '2px solid var(--rule-strong)',
                      color: 'var(--ink-2)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      boxShadow: '4px 0 6px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span aria-hidden>📝</span>
                      {onDayNoteLabelSave ? (
                        <input
                          type="text"
                          key={`label-${rowNo}_${labelValue}`}
                          defaultValue={labelValue}
                          maxLength={20}
                          placeholder={`メモ${rowNo}`}
                          onBlur={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (v !== labelValue) onDayNoteLabelSave(rowNo, v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          className="w-[110px] outline-none rounded px-1 focus:bg-[var(--accent-pale)]"
                          style={{ background: 'transparent', border: '1px dashed var(--rule)', color: 'var(--ink-2)', fontSize: '0.7rem', fontWeight: 600 }}
                          aria-label={`メモ${rowNo}の名称`}
                          title="行の名称を変更できます（施設・月ごと。例: 学校行事 / 会議）"
                        />
                      ) : (
                        <span>{labelValue || `メモ${rowNo}`}</span>
                      )}
                    </div>
                  </td>
                  {dates.map((d) => {
                    const noteKey = `${d.dateStr}_${rowNo}`;
                    const value = dayNotes?.get(noteKey) ?? '';
                    const isTodayCol = d.dateStr === today;
                    return (
                      <td
                        key={d.dateStr}
                        className="p-0 align-middle"
                        style={{
                          borderBottom: isLastNote ? '2px solid var(--rule-strong)' : '1px solid var(--rule)',
                          borderRight: isTodayCol ? '2px solid var(--accent)' : '1px solid var(--rule)',
                          borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                          background: getCellBg(d.dow, !!d.holidayName),
                        }}
                      >
                        <input
                          type="text"
                          key={`${noteKey}_${value}`}
                          defaultValue={value}
                          maxLength={50}
                          onBlur={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (v !== value) onDayNoteSave(d.dateStr, rowNo, v);
                          }}
                          onKeyDown={(e) => {
                            // Enter で確定（blur → 保存）。キーボードのみでも編集を完結できるように
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          className="day-note-input w-full text-center outline-none focus:bg-[var(--accent-pale)]"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            fontSize: '0.62rem',
                            fontWeight: 600,
                            color: 'var(--accent)',
                            padding: '4px 2px',
                            minWidth: 0,
                          }}
                          aria-label={`${month}月${d.day}日 メモ${rowNo}`}
                          title={value || undefined}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}

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
                {/* 行の高さをシフト表 ShiftGridFull の職員名セルと揃えるため、
                    「氏名 + 学年バッジ」で 1 行、「出席数」で 1 行の計 2 行に収める。
                    学年を独立した行に置くと 3 行になり、利用表だけ行が高くなる。 */}
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="group-hover:text-[var(--accent)] transition-colors">{child.name}</span>
                    {child.grade_label && (
                      <span
                        className="schedule-grade-badge px-1 rounded"
                        style={{ background: 'var(--accent-pale)', color: 'var(--accent)', fontSize: '0.6rem', fontWeight: 600 }}
                      >
                        {child.grade_label}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const a = childAttendedDays.get(child.id) ?? 0;
                    const w = childWaitlistDays.get(child.id) ?? 0;
                    if (a === 0 && w === 0) return null;
                    return (
                      <div
                        className="flex items-center gap-1.5 leading-none"
                        style={{ fontSize: '0.62rem', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}
                        title={`今月: 出席 ${a} 日 / 待機 ${w} 日`}
                      >
                        {a > 0 && <span style={{ color: 'var(--green)', fontWeight: 600 }}>出{a}</span>}
                        {w > 0 && <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>待{w}</span>}
                      </div>
                    );
                  })()}
                </div>
              </td>
              {dates.map((d) => {
                const cell = cellMap.get(`${child.id}_${d.dateStr}`);
                const hasTimes = !!(cell && (cell.pickup_time || cell.dropoff_time));
                const hasEntry = !!cell && (cell.entry_id ?? null) !== null;
                const isAbsent = cell?.attendance_status === 'absent';
                const isLeave = cell?.attendance_status === 'leave';
                const isWaitlist = cell?.attendance_status === 'waitlist';
                const isOff = isLeave || (hasEntry && !hasTimes && !isAbsent && !isWaitlist);

                let bg = getCellBg(d.dow, !!d.holidayName);
                if (isAbsent) bg = 'var(--red-pale)';
                else if (isWaitlist) bg = 'rgba(0,0,0,0.06)';
                else if (isOff) bg = 'rgba(0,0,0,0.04)';

                const isTodayCol = d.dateStr === today;

                return (
                  <td
                    key={d.dateStr}
                    className="px-0.5 py-1 text-center transition-colors cursor-pointer group-hover:!bg-[var(--accent-pale)]"
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
                      <span className="font-medium" style={{ color: 'var(--accent)', fontSize: '0.62rem' }}>
                        {cell.note}
                      </span>
                    ) : isAbsent ? (
                      <span className="font-bold" style={{ color: 'var(--red)', fontSize: '0.62rem' }}>欠席</span>
                    ) : isWaitlist ? (
                      <div
                        className="flex flex-col gap-0.5 leading-tight py-0.5"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        <span className="font-bold" style={{ color: 'var(--ink-2)', fontSize: '0.62rem' }}>
                          キャ待{cell?.waitlist_order ? ` ${WAITLIST_MARKS.charAt(cell.waitlist_order - 1)}` : ''}
                        </span>
                        {cell?.pickup_time && (
                          <span style={{ color: 'var(--ink-3)', fontSize: '0.6rem' }}>
                            {formatHM(cell.pickup_time)}
                          </span>
                        )}
                        {cell?.dropoff_time && (
                          <span style={{ color: 'var(--ink-3)', fontSize: '0.6rem' }}>
                            {formatHM(cell.dropoff_time)}
                          </span>
                        )}
                      </div>
                    ) : isOff ? (
                      <span className="font-bold" style={{ color: 'var(--ink-3)', fontSize: '0.62rem' }}>お休み</span>
                    ) : hasTimes ? (
                      <div className="flex flex-col gap-0.5 leading-tight py-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {cell?.pickup_time && (
                          cell.pickup_method === 'self' ? (
                            <span style={{ color: 'var(--ink-3)', fontSize: '0.62rem' }}>
                              自 {formatHM(cell.pickup_time)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--accent)', fontSize: '0.62rem' }}>
                              迎 {formatHM(cell.pickup_time)}
                            </span>
                          )
                        )}
                        {cell?.dropoff_time && (
                          cell.dropoff_method === 'self' ? (
                            <span style={{ color: 'var(--ink-3)', fontSize: '0.62rem' }}>
                              自 {formatHM(cell.dropoff_time)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--green)', fontSize: '0.62rem' }}>
                              送 {formatHM(cell.dropoff_time)}
                            </span>
                          )
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--ink-3)', opacity: 0.5, fontSize: '0.62rem' }}>−</span>
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
              <div className="flex items-baseline gap-2">
                <span>利用数</span>
                <span
                  style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}
                  title={`${month}月の延べ利用数（日別の合計）`}
                >
                  計 {monthlyTotal}
                </span>
              </div>
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
                    background: isTodayCol ? 'var(--accent-pale)' : getStickyBg(d.dow, !!d.holidayName),
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
                <div className="flex items-baseline gap-2">
                  <span>キャンセル待ち</span>
                  <span
                    style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}
                    title={`${month}月の延べキャンセル待ち件数（日別の合計）`}
                  >
                    計 {monthlyWaitlistTotal}
                  </span>
                </div>
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
                      background: isTodayCol ? 'var(--accent-pale)' : getStickyBg(d.dow, !!d.holidayName),
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
