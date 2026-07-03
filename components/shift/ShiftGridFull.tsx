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
  /* migration 130: 兼任職員判定用。主所属 facility が現在表示中の facility と異なるとき
     名前横に「兼任」バッジを表示する。 */
  primary_facility_id?: string | null;
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

/** 兼任職員の他施設勤務（先方要望④）。name=施設名（複数なら「・」連結）、detail=勤務時刻帯 */
export interface CrossFacilityWork {
  name: string;
  detail: string;
}

interface ShiftGridProps {
  year: number;
  month: number;
  staff: ShiftStaff[];
  cells: ShiftCell[];
  warnings: ShiftWarning[];
  onCellClick: (staffId: string, date: string) => void;
  childrenCountByDate?: Map<string, number>;
  /** Phase 64: 日別キャンセル待ち件数（バッジ「待 N」表示用） */
  childrenWaitlistCountByDate?: Map<string, number>;
  /** facility_shift_settings.core_start_time (HH:MM)。未指定時は 10:30 */
  coreStartTime?: string | null;
  /** facility_shift_settings.core_end_time (HH:MM)。未指定時は 16:30 */
  coreEndTime?: string | null;
  /** facility_shift_settings.min_qualified_staff。「有資格者基準」判定用 */
  minQualifiedStaff?: number;
  /** migration 130: 現在表示中の facility id。兼任職員判定で primary_facility_id と比較する。 */
  currentFacilityId?: string | null;
  /** migration 130 → 先方要望④で拡張: 兼任職員が他施設で勤務している cell の表示用マップ。
       key=`${staff_id}_${date}`。休みセルは「○○ 勤務」バッジ、出勤系セルは ⚠ 重複マーカーを表示
       （従来は本施設に行が 1 つでもあると非表示になり、生成後は事実上見えなかった）。 */
  crossFacilityWorkByCell?: Map<string, CrossFacilityWork>;
  /** migration 219: 日別メモ2行（学校行事・施設行事・会議など）。key=`${date}_${rowNo}` */
  dayNotes?: Map<string, string>;
  /** メモ編集の保存（blur 時）。未指定ならメモ行自体を描画しない */
  onDayNoteSave?: (date: string, rowNo: 1 | 2, text: string) => void;
  /** 先方要望②: セルの右クリック（Excel風コピー/貼り付けメニュー起動）。clientX/Y で表示位置を渡す */
  onCellContextMenu?: (staffId: string, date: string, clientX: number, clientY: number) => void;
  /** 貼り付けモード中のコピー元セル key=`${staffId}_${date}`。うっすらハイライトして所在を示す */
  copiedCellKey?: string | null;
}

const TYPE_CONFIG: Record<ShiftAssignmentType, { label: string; color: string; bg: string }> = {
  normal: { label: '出勤', color: 'var(--ink)', bg: 'transparent' },
  public_holiday: { label: '公休', color: 'var(--accent)', bg: 'var(--accent-pale)' },
  requested_off: { label: '希望休', color: 'var(--gold)', bg: 'var(--gold-pale)' },
  paid_leave: { label: '有給', color: 'var(--green)', bg: 'var(--green-pale)' },
  off: { label: '休', color: 'var(--ink-3)', bg: 'rgba(0,0,0,0.03)' },
  /* 半休（migration 218）: 休み希望UIの AM休=青系 / PM休=藍系 に合わせる。
     AM休=午後勤務[14:30,退勤] / PM休=午前勤務[出勤,13:30] */
  am_off: { label: 'AM休', color: '#2563eb', bg: '#eff6ff' },
  pm_off: { label: 'PM休', color: '#4f46e5', bg: '#eef2ff' },
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
  childrenWaitlistCountByDate,
  coreStartTime,
  coreEndTime,
  minQualifiedStaff = 2,
  currentFacilityId = null,
  crossFacilityWorkByCell,
  dayNotes,
  onDayNoteSave,
  onCellContextMenu,
  copiedCellKey,
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

  // work=出勤 / ph=公休 / ro=希望休 / pl=有給
  const countsByStaff = new Map<string, { work: number; ph: number; ro: number; pl: number }>();
  staff.forEach((s) => countsByStaff.set(s.id, { work: 0, ph: 0, ro: 0, pl: 0 }));
  cellSegmentsMap.forEach((segs, key) => {
    const [staffId] = key.split('_');
    const rec = countsByStaff.get(staffId);
    if (!rec) return;
    const type = pickPrimary(segs)?.assignment_type;
    // 半休(am_off/pm_off)も出勤日として work に計上（半日でも出勤日）
    if (type === 'normal' || type === 'am_off' || type === 'pm_off') rec.work++;
    else if (type === 'public_holiday') rec.ph++;
    else if (type === 'requested_off') rec.ro++;
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
      // 半休(am_off/pm_off)も在席日として日次出勤数に含める
      if (segs && segs.some((c) => c.assignment_type === 'normal' || c.assignment_type === 'am_off' || c.assignment_type === 'pm_off')) count++;
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
        coreStartTime,
        coreEndTime,
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
              className="shift-grid-sticky-corner sticky left-0 top-0 z-50 px-4 py-4 text-left font-bold"
              style={{
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
                    const waitlistCount = childrenWaitlistCountByDate?.get(d.dateStr) ?? 0;
                    if (childCount === 0 && waitlistCount === 0) return null;
                    return (
                      <div style={{ fontSize: '0.6rem', color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1 }}>
                        {childCount > 0 && <span>{childCount}人</span>}
                        {waitlistCount > 0 && (
                          <span
                            style={{
                              marginLeft: childCount > 0 ? '3px' : '0',
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
          {/* 日別メモ2行（migration 219 / 先方要望①）: 日付ヘッダと職員行の間。
              入力は非制御 (defaultValue + onBlur 保存) — 制御化すると 31日×2行の入力の
              たびにグリッド全体が再レンダされ重くなるため。key に保存値を含めて
              refetch 後の値変化時のみ remount して同期する。 */}
          {onDayNoteSave &&
            ([1, 2] as const).map((rowNo) => (
              <tr key={`day-note-${rowNo}`}>
                <td
                  className="shift-grid-sticky-staff sticky left-0 z-30 px-4 py-1 whitespace-nowrap"
                  style={{
                    borderBottom: rowNo === 2 ? '2px solid var(--rule-strong)' : '1px solid var(--rule)',
                    borderRight: '2px solid var(--rule-strong)',
                    color: 'var(--ink-2)',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    boxShadow: '4px 0 6px rgba(0,0,0,0.02)',
                  }}
                  title="学校行事・施設行事・会議などを自由に記入できます（シフト作成用メモ。職員には公開されません）"
                >
                  📝 メモ {rowNo}
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
                        borderBottom: rowNo === 2 ? '2px solid var(--rule-strong)' : '1px solid var(--rule)',
                        borderRight: isTodayCol ? '2px solid var(--accent)' : '1px solid var(--rule)',
                        borderLeft: isTodayCol ? '2px solid var(--accent)' : undefined,
                        background: getCellBg(d.dow),
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
            ))}

          {staff.map((s) => (
            <tr
              key={s.id}
              className="group cursor-pointer transition-colors"
              style={s.is_qualified ? { background: 'var(--gold-pale, #fdf6e3)' } : undefined}
            >
              <td
                className="shift-grid-sticky-staff sticky left-0 z-30 px-4 py-3 font-semibold whitespace-nowrap"
                data-qualified={s.is_qualified ? 'true' : 'false'}
                style={{
                  borderBottom: '1px solid var(--rule)',
                  borderRight: '2px solid var(--rule-strong)',
                  color: 'var(--ink)',
                  boxShadow: '4px 0 6px rgba(0,0,0,0.02)',
                }}
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="group-hover:text-[var(--accent)] transition-colors">{s.name}</span>
                    {/* migration 130: 主所属が現 facility と異なる = 兼任で来てる職員 */}
                    {currentFacilityId && s.primary_facility_id && s.primary_facility_id !== currentFacilityId && (
                      <span
                        className="text-xs px-1 rounded"
                        style={{ background: 'var(--accent-pale)', color: 'var(--accent)', fontSize: '0.6rem' }}
                        title="他事業所が主所属の兼任職員"
                      >
                        兼任
                      </span>
                    )}
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
                    const c = countsByStaff.get(s.id) ?? { work: 0, ph: 0, ro: 0, pl: 0 };
                    return (
                      <div
                        className="flex items-center gap-1.5 leading-none"
                        style={{ fontSize: '0.62rem', color: 'var(--ink-3)', fontWeight: 400 }}
                      >
                        <span>出勤{c.work}日</span>
                        {c.ph > 0 && <span style={{ color: 'var(--accent)' }}>公休{c.ph}</span>}
                        {c.ro > 0 && <span style={{ color: 'var(--gold)' }}>希望休{c.ro}</span>}
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
                /* 先方要望④（全施設同時作成の相互反映）。判定は【時間が入っているか】:
                   crossWork は「他施設に時間ありの勤務がある」ときだけ存在する（ShiftFull 側で
                   start_time NULL は除外済＝公休/希望休/有給/休みは他施設勤務に数えない）。
                   - 自施設が休(off)/未設定 → 「○○ 勤務」バッジに置き換え
                   - 自施設も時間あり(normal/am_off/pm_off) → 二重アサイン ⚠（赤）
                   - 自施設が公休/希望休/有給（時間なしの明示休暇）→ 他施設バッジは出さない（そのラベルのみ） */
                const crossWork = crossFacilityWorkByCell?.get(`${s.id}_${d.dateStr}`);
                /* 自施設で時間が入っている = ここで勤務している（normal/am_off/pm_off はいずれも時刻を持つ） */
                const selfHasTime = type === 'normal' || type === 'am_off' || type === 'pm_off';
                const showCrossBadge = !!crossWork && type === 'off';
                const crossTitle = crossWork
                  ? `${crossWork.name} で勤務予定${crossWork.detail ? `（${crossWork.detail}）` : ''}`
                  : '';
                const titleBits: string[] = [];
                if (type === 'normal') {
                  titleBits.push(
                    segs
                      .filter((c) => c.assignment_type === 'normal')
                      .map((c) => `${c.start_time}〜${c.end_time}`)
                      .join(' / ')
                  );
                } else if (!showCrossBadge) {
                  titleBits.push(config.label);
                }
                /* crossWork をツールチップに出すのは「休みセルのバッジ」または「自施設も勤務=重複」のときだけ。
                   公休/希望休/有給には出さない（先方要望: これらは空）。 */
                if (crossWork && (showCrossBadge || selfHasTime)) {
                  titleBits.push(selfHasTime ? `⚠ ${crossTitle} — 重複に注意` : crossTitle);
                }
                const baseTitle = titleBits.filter(Boolean).join('\n') || config.label;
                const normalSegs = segs.filter((c) => c.assignment_type === 'normal');

                const cellBg = type !== 'normal'
                  ? (showCrossBadge ? 'var(--accent-pale)' : config.bg)
                  : s.is_qualified
                  ? 'var(--gold-pale, #fdf6e3)'
                  : getCellBg(d.dow);
                const isTodayCol = d.dateStr === today;
                const isCopiedCell = copiedCellKey === `${s.id}_${d.dateStr}`;
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
                      /* コピー元セルは Excel の「点線マーキー」風に破線枠でハイライト */
                      outline: isCopiedCell ? '2px dashed var(--accent)' : undefined,
                      outlineOffset: isCopiedCell ? '-2px' : undefined,
                    }}
                    onClick={() => onCellClick(s.id, d.dateStr)}
                    onContextMenu={
                      onCellContextMenu
                        ? (e) => {
                            e.preventDefault();
                            onCellContextMenu(s.id, d.dateStr, e.clientX, e.clientY);
                          }
                        : undefined
                    }
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
                        {/* 自施設で勤務(時間あり)なのに他施設でも勤務 = 二重アサイン警告（色+アイコン+施設名） */}
                        {crossWork && (
                          <span
                            className="font-bold"
                            style={{ color: 'var(--red)', fontSize: '0.58rem', lineHeight: 1.1 }}
                          >
                            ⚠{crossWork.name}
                          </span>
                        )}
                      </div>
                    ) : showCrossBadge ? (
                      /* 他施設で勤務する日（本施設は休み扱い） — クリックで本施設シフトの編集は可能 */
                      <div className="flex flex-col gap-0.5 leading-tight py-0.5">
                        <span
                          className="font-semibold"
                          style={{
                            color: 'var(--accent)',
                            fontSize: '0.65rem',
                            lineHeight: 1.1,
                          }}
                        >
                          {crossWork?.name}
                        </span>
                        <span style={{ color: 'var(--accent)', fontSize: '0.6rem', lineHeight: 1.1 }}>勤務</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5 leading-tight py-0.5">
                        {(type === 'public_holiday' || type === 'requested_off' || type === 'off') && cell?.note && (
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
                        {/* 自施設も時間あり(半休 am_off/pm_off)のときだけ ⚠重複。
                            公休/希望休/有給(時間なし)には他施設バッジを出さない（先方要望: 空）。 */}
                        {crossWork && selfHasTime && (
                          <span
                            className="font-bold"
                            style={{ color: 'var(--red)', fontSize: '0.58rem', lineHeight: 1.1 }}
                          >
                            ⚠{crossWork.name}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}

          <tr>
            <td
              className="shift-grid-sticky-corner sticky left-0 bottom-0 z-50 px-4 py-3 font-bold"
              style={{
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

          {/* 有資格者基準: コアタイム重複の有資格者数が min_qualified_staff 以上か（✓/✗） */}
          <CoverageRow
            label="有資格者基準"
            title={`コアタイム(${(coreStartTime ?? '10:30').slice(0,5)}〜${(coreEndTime ?? '16:30').slice(0,5)})に重なる有資格者数が ${minQualifiedStaff} 名以上か`}
            dates={dates}
            getCellBg={getCellBg}
            render={(d) => {
              const cov = coverageByDate.get(d.dateStr);
              if (!cov) return { value: '', color: 'var(--ink-3)' };
              if (d.dow === 0 && cov.childrenCount === 0) return { value: '', color: 'var(--ink-3)' };
              const ok = cov.qualifiedCount >= minQualifiedStaff;
              return ok
                ? { value: '✓', color: 'var(--green)' }
                : { value: '✗', color: 'var(--red)', bg: 'var(--red-pale)' };
            }}
          />

          {/* 提供時間内の有資格者: コアタイム中の最小有資格者数（min_qualified_staff を下回ると赤） */}
          <CoverageRow
            label="提供時間内の有資格者"
            title={`コアタイム中の有資格者最小人数（30分刻みで走査）。${minQualifiedStaff} 名未満で警告`}
            dates={dates}
            getCellBg={getCellBg}
            render={(d) => {
              const cov = coverageByDate.get(d.dateStr);
              if (!cov) return { value: '', color: 'var(--ink-3)' };
              if (d.dow === 0 && cov.childrenCount === 0) return { value: '', color: 'var(--ink-3)' };
              if (cov.minCoverage === '不足') {
                return { value: '不足', color: 'var(--red)', bg: 'var(--red-pale)' };
              }
              const n = cov.minCoverage as number;
              const color =
                n < minQualifiedStaff ? 'var(--red)'
                : n === minQualifiedStaff ? 'var(--gold)'
                : 'var(--green)';
              return { value: String(n), color, bg: n < minQualifiedStaff ? 'var(--red-pale)' : undefined };
            }}
          />

          {/* 余力: 児童数 ÷ コアタイム出勤者数。≥4 で赤警告（職員1人で4人以上=不可能） */}
          <CoverageRow
            label="余力"
            title={'児童数 ÷ コアタイム出勤職員数。3 未満は緑 / 3〜4 未満は黄 / 4 以上は赤（1 職員で 4 人以上は警告）'}
            dates={dates}
            getCellBg={getCellBg}
            isLast
            render={(d) => {
              const cov = coverageByDate.get(d.dateStr);
              if (!cov || cov.childrenCount === 0) return { value: '', color: 'var(--ink-3)' };
              if (cov.coreStaffCount === 0) {
                return { value: '⚠ 職員0', color: 'var(--red)', bg: 'var(--red-pale)', fontSize: '0.6rem' };
              }
              const ratio = cov.childrenCount / cov.coreStaffCount;
              const r1 = Math.round(ratio * 10) / 10;
              if (ratio >= 4) {
                return { value: `⚠ ${r1}`, color: 'var(--red)', bg: 'var(--red-pale)', fontSize: '0.7rem' };
              }
              if (ratio >= 3) {
                return { value: String(r1), color: 'var(--gold)', bg: 'var(--gold-pale-solid)' };
              }
              return { value: String(r1), color: 'var(--green)' };
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
        className="shift-grid-sticky-corner sticky left-0 bottom-0 z-50 px-4 py-2 font-semibold text-xs"
        style={{
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
