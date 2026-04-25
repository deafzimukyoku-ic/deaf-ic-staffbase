'use client';

import { useEffect, useRef } from 'react';
import { getDaysInMonth, getDay } from 'date-fns';
import type { ShiftAssignmentType } from '@/lib/types';
import { calculateCoverage } from '@/lib/logic/qualifiedCoverage';
import { todayStr } from '@/lib/date/isToday';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';

/**
 * シフトグリッド（職員×日付）
 * 移植元: diletto-shift-maker/src/components/shift/ShiftGrid.tsx (596行)
 * 機械的変換:
 *  - staff_id（cell, props）→ employee_id ベース。propsの命名は staffId（呼び出し側で employee.id を渡す）
 *  - requestComments プロップ削除（案Z では shift_change_requests を使用するため不要）
 */

interface ShiftStaff {
  id: string;
  name: string;
  employment_type: 'full_time' | 'part_time';
  is_qualified: boolean;
}

interface ShiftCell {
  staff_id: string; // = employee.id（互換のため staff_id 名で受け取る）
  date: string;
  start_time: string | null;
  end_time: string | null;
  assignment_type: ShiftAssignmentType;
  segment_order?: number;
  note?: string | null;
}

interface ShiftWarning {
  date: string;
  type: 'understaffed' | 'no_qualified' | 'overworked';
  message: string;
}

interface ShiftGridProps {
  year: number;
  month: number;
  staff: ShiftStaff[];
  cells: ShiftCell[];
  warnings: ShiftWarning[];
  onCellClick: (staffId: string, date: string) => void;
  childrenCountByDate?: Map<string, number>;
}

const TYPE_CONFIG: Record<ShiftAssignmentType, { label: string; color: string; bg: string }> = {
  normal: { label: '出勤', color: 'var(--ink)', bg: 'transparent' },
  public_holiday: { label: '公休', color: 'var(--accent)', bg: 'var(--accent-pale)' },
  paid_leave: { label: '有給', color: 'var(--green)', bg: 'var(--green-pale)' },
  off: { label: '休', color: 'var(--ink-3)', bg: 'rgba(0,0,0,0.03)' },
};

const DOW_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

export default function ShiftGridFull({
  year,
  month,
  staff,
  cells,
  warnings,
  onCellClick,
  childrenCountByDate,
}: ShiftGridProps) {
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const dates: { day: number; dow: number; dateStr: string }[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    dates.push({
      day: d,
      dow: getDay(dateObj),
      dateStr: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    });
  }

  /* 分割シフト対応: Map<key, ShiftCell[]> */
  const cellSegmentsMap = new Map<string, ShiftCell[]>();
  cells.forEach((c) => {
    const key = `${c.staff_id}_${c.date}`;
    const arr = cellSegmentsMap.get(key);
    if (arr) arr.push(c);
    else cellSegmentsMap.set(key, [c]);
  });
  cellSegmentsMap.forEach((arr) => {
    arr.sort((a, b) => (a.segment_order ?? 0) - (b.segment_order ?? 0));
  });

  /* primary 選択: off 以外の最後 */
  const pickPrimary = (arr: ShiftCell[]): ShiftCell | undefined => {
    const nonOff = arr.filter((c) => c.assignment_type !== 'off');
    const source = nonOff.length > 0 ? nonOff : arr;
    return source[source.length - 1];
  };

  const countsByStaff = new Map<string, { work: number; ph: number; pl: number }>();
  staff.forEach((s) => countsByStaff.set(s.id, { work: 0, ph: 0, pl: 0 }));
  cellSegmentsMap.forEach((segs, key) => {
    const [staffId] = key.split('_');
    const rec = countsByStaff.get(staffId);
    if (!rec) return;
    const type = pickPrimary(segs)?.assignment_type;
    if (type === 'normal') rec.work++;
    else if (type === 'public_holiday') rec.ph++;
    else if (type === 'paid_leave') rec.pl++;
  });

  const warningMap = new Map<string, ShiftWarning[]>();
  warnings.forEach((w) => {
    const existing = warningMap.get(w.date) || [];
    existing.push(w);
    warningMap.set(w.date, existing);
  });

  const dailyWorkingCount = new Map<string, number>();
  dates.forEach((d) => {
    let count = 0;
    staff.forEach((s) => {
      const segs = cellSegmentsMap.get(`${s.id}_${d.dateStr}`);
      if (segs && segs.some((c) => c.assignment_type === 'normal')) count++;
    });
    dailyWorkingCount.set(d.dateStr, count);
  });

  /* カバレッジ計算 */
  const staffQualifiedMap = new Map(staff.map((s) => [s.id, s.is_qualified]));
  const coverageByDate = new Map<string, ReturnType<typeof calculateCoverage>>();
  dates.forEach((d) => {
    const scheduleCount = childrenCountByDate?.get(d.dateStr) ?? 0;
    coverageByDate.set(
      d.dateStr,
      calculateCoverage({
        date: d.dateStr,
        shifts: cells,
        staffQualifiedMap,
        scheduleCount,
      })
    );
  });

  /* 今日列の自動スクロール */
  const today = todayStr();
  const todayInMonth = dates.some((d) => d.dateStr === today);
  const todayHeaderRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    if (!todayInMonth) return;
    todayHeaderRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [todayInMonth, today]);

  const getDowColor = (dow: number, isHoliday = false) => {
    if (isHoliday || dow === 0) return 'var(--red)';
    if (dow === 6) return 'var(--accent)';
    return 'var(--ink-2)';
  };

  const getCellBg = (dow: number) => {
    if (dow === 0) return 'rgb(252,249,249)';
    if (dow === 6) return 'rgb(248,249,253)';
    return 'var(--white)';
  };

  return (
    <div className="flex-1 overflow-auto border-2 rounded-xl" style={{ borderColor: 'var(--rule)', background: 'var(--white)' }}>
      <table
        className="w-full border-separate border-spacing-0"
        style={{ minWidth: `${dates.length * 56 + 180}px`, fontSize: '0.85rem' }}
      >
        <thead>
          <tr>
            <th
              className="sticky left-0 top-0 z-50 px-4 py-4 text-left font-bold"
              style={{
                background: 'var(--bg)',
                borderBottom: '2px solid var(--rule-strong)',
                borderRight: '2px solid var(--rule-strong)',
                minWidth: '160px',
                color: 'var(--ink)',
                boxShadow: '4px 4px 10px rgba(0,0,0,0.03)',
              }}
            >
              職員名
            </th>
            {dates.map((d) => {
              const dayWarnings = warningMap.get(d.dateStr) || [];
              const hasWarning = dayWarnings.length > 0;
              const isUnderstaffed = dayWarnings.some((w) => w.type === 'understaffed');
              const isTodayCol = d.dateStr === today;
              const holiday = isJpHoliday(d.dateStr);
              const holidayName = holiday ? jpHolidayName(d.dateStr) : null;
              const titleBits: string[] = [];
              if (isTodayCol) titleBits.push('今日');
              if (holidayName) titleBits.push(holidayName);
              for (const w of dayWarnings) titleBits.push(w.message);

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
                    background: isTodayCol
                      ? 'var(--accent-pale-solid)'
                      : isUnderstaffed
                      ? 'var(--red-pale)'
                      : hasWarning
                      ? 'var(--gold-pale)'
                      : getCellBg(d.dow),
                    color: isTodayCol ? 'var(--accent)' : getDowColor(d.dow, holiday),
                    boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                  }}
                  title={titleBits.join('\n') || undefined}
                >
                  <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{DOW_SHORT[d.dow]}</div>
                  <div style={{ fontSize: '0.85rem' }}>{d.day}</div>
                  {(() => {
                    const childCount = childrenCountByDate?.get(d.dateStr) ?? 0;
                    if (childCount === 0) return null;
                    return (
                      <div style={{ fontSize: '0.6rem', color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1 }}>
                        {childCount}人
                      </div>
                    );
                  })()}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr
              key={s.id}
              className="group cursor-pointer transition-colors"
              style={s.is_qualified ? { background: 'var(--gold-pale, #fdf6e3)' } : undefined}
            >
              <td
                className="sticky left-0 z-20 px-4 py-3 font-semibold whitespace-nowrap group-hover:!bg-[var(--accent-pale-solid)] transition-colors"
                style={{
                  background: s.is_qualified ? 'var(--gold-pale-solid)' : 'var(--white)',
                  borderBottom: '1px solid var(--rule)',
                  borderRight: '2px solid var(--rule-strong)',
                  color: 'var(--ink)',
                  boxShadow: '4px 0 6px rgba(0,0,0,0.02)',
                }}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="group-hover:text-[var(--accent)] transition-colors">{s.name}</span>
                    {s.is_qualified && (
                      <span
                        className="text-xs px-1 rounded"
                        style={{ background: 'var(--green-pale)', color: 'var(--green)', fontSize: '0.6rem' }}
                      >
                        有資格
                      </span>
                    )}
                  </div>
                  {(() => {
                    const c = countsByStaff.get(s.id) ?? { work: 0, ph: 0, pl: 0 };
                    return (
                      <div
                        className="flex items-center gap-1.5 leading-none"
                        style={{ fontSize: '0.62rem', color: 'var(--ink-3)', fontWeight: 400 }}
                      >
                        <span>出勤{c.work}日</span>
                        {c.ph > 0 && <span style={{ color: 'var(--accent)' }}>公休{c.ph}</span>}
                        {c.pl > 0 && <span style={{ color: 'var(--green)' }}>有給{c.pl}</span>}
                      </div>
                    );
                  })()}
                </div>
              </td>
              {dates.map((d) => {
                const segs = cellSegmentsMap.get(`${s.id}_${d.dateStr}`) ?? [];
                const cell = pickPrimary(segs);
                const type = cell?.assignment_type || 'off';
                const config = TYPE_CONFIG[type];
                const baseTitle =
                  type === 'normal'
                    ? segs
                        .filter((c) => c.assignment_type === 'normal')
                        .map((c) => `${c.start_time}〜${c.end_time}`)
                        .join(' / ')
                    : config.label;
                const normalSegs = segs.filter((c) => c.assignment_type === 'normal');

                const cellBg = type !== 'normal'
                  ? config.bg
                  : s.is_qualified
                  ? 'var(--gold-pale, #fdf6e3)'
                  : getCellBg(d.dow);
                const isTodayCol = d.dateStr === today;
                return (
                  <td
                    key={d.dateStr}
                    className="px-0.5 py-1 text-center cursor-pointer transition-colors group-hover:!bg-[var(--accent-pale)] relative"
                    style={{
                      borderBottom: '1px solid var(--rule)',
                      borderRight: isTodayCol ? '2px solid var(--accent)' : '1px solid var(--rule)',
                      borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                      background: cellBg,
                      position: 'relative',
                    }}
                    onClick={() => onCellClick(s.id, d.dateStr)}
                    title={baseTitle}
                  >
                    {type === 'normal' ? (
                      <div className="flex flex-col gap-0.5 leading-tight py-0.5">
                        {cell?.note && (
                          <span
                            style={{
                              color: 'var(--accent)',
                              fontSize: '0.62rem',
                              lineHeight: 1.1,
                              fontWeight: 600,
                            }}
                          >
                            {cell.note}
                          </span>
                        )}
                        {normalSegs.length > 1 ? (
                          normalSegs.map((seg, i) => (
                            <span
                              key={`${seg.segment_order ?? i}-${seg.start_time}`}
                              style={{ color: 'var(--ink-2)', fontSize: '0.6rem', lineHeight: 1.1 }}
                            >
                              {seg.start_time?.slice(0, 5)}-{seg.end_time?.slice(0, 5)}
                            </span>
                          ))
                        ) : (
                          <>
                            {cell?.start_time && (
                              <span style={{ color: 'var(--ink-2)', fontSize: '0.68rem' }}>
                                {cell.start_time.slice(0, 5)}
                              </span>
                            )}
                            {cell?.end_time && (
                              <span style={{ color: 'var(--ink-3)', fontSize: '0.68rem' }}>
                                {cell.end_time.slice(0, 5)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5 leading-tight py-0.5">
                        {(type === 'public_holiday' || type === 'off') && cell?.note && (
                          <span
                            style={{
                              color: 'var(--accent)',
                              fontSize: '0.62rem',
                              lineHeight: 1.1,
                              fontWeight: 600,
                            }}
                          >
                            {cell.note}
                          </span>
                        )}
                        <span className="font-semibold" style={{ color: config.color, fontSize: '0.7rem' }}>
                          {config.label}
                        </span>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}

          <tr>
            <td
              className="sticky left-0 bottom-0 z-50 px-4 py-3 font-bold"
              style={{
                background: 'var(--bg)',
                borderTop: '2px solid var(--rule-strong)',
                borderRight: '2px solid var(--rule-strong)',
                color: 'var(--ink)',
                boxShadow: '4px -4px 6px rgba(0,0,0,0.02)',
              }}
            >
              出勤数
            </td>
            {dates.map((d) => {
              const count = dailyWorkingCount.get(d.dateStr) || 0;
              return (
                <td
                  key={d.dateStr}
                  className="px-1 py-2 text-center font-bold"
                  style={{
                    borderTop: '2px solid var(--rule-strong)',
                    borderRight: '1px solid var(--rule)',
                    color: count > 3 ? 'var(--green)' : count > 0 ? 'var(--gold)' : 'var(--ink-3)',
                    background: getCellBg(d.dow),
                  }}
                >
                  {count > 0 ? count : ''}
                </td>
              );
            })}
          </tr>

          <CoverageRow
            label="有資格者"
            title="コアタイム(10:30〜16:30)に重なる有資格者数"
            dates={dates}
            getCellBg={getCellBg}
            render={(d) => {
              const cov = coverageByDate.get(d.dateStr);
              if (!cov) return { value: '', color: 'var(--ink-3)' };
              if (d.dow === 0 && cov.childrenCount === 0) return { value: '', color: 'var(--ink-3)' };
              if (cov.qualifiedCount === 0) return { value: '', color: 'var(--ink-3)' };
              return {
                value: String(cov.qualifiedCount),
                color: cov.qualifiedCount >= 2 ? 'var(--green)' : 'var(--gold)',
              };
            }}
          />
          <CoverageRow
            label="提供時間"
            title="コアタイムを常時2名以上で満たしているか"
            dates={dates}
            getCellBg={getCellBg}
            render={(d) => {
              const cov = coverageByDate.get(d.dateStr);
              if (!cov) return { value: '', color: 'var(--ink-3)' };
              if (d.dow === 0 && cov.childrenCount === 0) return { value: '', color: 'var(--ink-3)' };
              if (cov.minCoverage === '不足') {
                return { value: '不足', color: 'var(--red)', bg: 'var(--red-pale)' };
              }
              return { value: String(cov.minCoverage), color: 'var(--green)' };
            }}
          />
          <CoverageRow
            label="余力"
            title={'3名重複時間が確保できているか（児童11人以上は自動判定せず「要確認」）'}
            dates={dates}
            getCellBg={getCellBg}
            isLast
            render={(d) => {
              const cov = coverageByDate.get(d.dateStr);
              if (!cov || cov.childrenCount === 0) return { value: '', color: 'var(--ink-3)' };
              if (cov.additional === 'OK') return { value: 'OK', color: 'var(--green)' };
              if (cov.additional === '不足') {
                return { value: '不足', color: 'var(--red)', bg: 'var(--red-pale)' };
              }
              return {
                value: `要確認(${cov.childrenCount})`,
                color: 'var(--gold)',
                bg: 'var(--gold-pale, #fdf6e3)',
                fontSize: '0.62rem',
              };
            }}
          />
        </tbody>
      </table>
    </div>
  );
}

interface CoverageRowProps {
  label: string;
  title: string;
  dates: { dateStr: string; dow: number; day: number }[];
  getCellBg: (dow: number) => string;
  render: (d: { dateStr: string; dow: number }) => {
    value: string;
    color: string;
    bg?: string;
    fontSize?: string;
  };
  isLast?: boolean;
}

function CoverageRow({ label, title, dates, getCellBg, render, isLast }: CoverageRowProps) {
  return (
    <tr>
      <td
        className="sticky left-0 bottom-0 z-50 px-4 py-2 font-semibold text-xs"
        style={{
          background: 'var(--bg)',
          borderTop: '1px solid var(--rule)',
          borderBottom: isLast ? 'none' : '1px solid var(--rule)',
          borderRight: '2px solid var(--rule-strong)',
          color: 'var(--ink-2)',
          boxShadow: isLast ? '4px -4px 6px rgba(0,0,0,0.02)' : undefined,
        }}
        title={title}
      >
        {label}
      </td>
      {dates.map((d) => {
        const { value, color, bg, fontSize } = render(d);
        const tint = bg ?? getCellBg(d.dow);
        const bgStyle = isLast
          ? tint
            ? `linear-gradient(${tint}, ${tint}), var(--bg)`
            : 'var(--bg)'
          : tint ?? 'var(--bg)';
        return (
          <td
            key={d.dateStr}
            className={`${isLast ? 'sticky bottom-0 z-40 ' : ''}px-1 py-1.5 text-center font-medium`}
            style={{
              borderTop: '1px solid var(--rule)',
              borderBottom: isLast ? undefined : '1px solid var(--rule)',
              borderRight: '1px solid var(--rule)',
              color,
              background: bgStyle,
              fontSize: fontSize ?? '0.72rem',
              boxShadow: isLast ? '0 -4px 4px rgba(0,0,0,0.02)' : undefined,
            }}
          >
            {value}
          </td>
        );
      })}
    </tr>
  );
}
