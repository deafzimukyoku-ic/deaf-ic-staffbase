'use client';

import { useEffect, useMemo, useState } from 'react';
import { getDaysInMonth, getDay } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';
import { todayStr } from '@/lib/date/isToday';
import { fetchMyFacilityIds } from '@/lib/multi-facility';
import type { ShiftAssignmentType } from '@/lib/types';

/**
 * 社員: 自分の所属 facility (主所属 + 兼任先) の今月 published シフトを表で表示。
 *
 * - /my/requests ページの「施設のシフト」タブ用 (休み希望と同居)
 * - 今月固定 (today 換算)。月セレクタは無し
 * - 表形式: 行 = 同 facility の active 社員、列 = 日付 (今月)
 * - セル = 出勤時刻 or 公休/希望休/有給/休み のラベル (色分け)
 * - 読み取り専用。published のみ (RLS で migration 160 が許可)
 *
 * RLS: sa_employee_facility_shifts (migration 160) により
 *   - get_my_facility_ids() に含まれる facility の
 *   - publish_status='published' の shift_assignments を全社員分 SELECT 可能
 */

interface ShiftRow {
  employee_id: string;
  facility_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  assignment_type: ShiftAssignmentType;
  note: string | null;
}

interface EmployeeRow {
  id: string;
  last_name: string;
  first_name: string;
  facility_id: string | null;
}

interface FacilityRow {
  id: string;
  name: string;
}

const TYPE_CONFIG: Record<ShiftAssignmentType, { label: string; bg: string; color: string }> = {
  normal:         { label: '出勤',   bg: 'bg-diletto-blue/5',   color: 'text-diletto-ink' },
  public_holiday: { label: '公休',   bg: 'bg-purple-50',        color: 'text-purple-700' },
  requested_off:  { label: '希望休', bg: 'bg-amber-50',         color: 'text-amber-700' },
  paid_leave:     { label: '有給',   bg: 'bg-emerald-50',       color: 'text-emerald-700' },
  off:            { label: '休み',   bg: 'bg-gray-50',          color: 'text-diletto-gray' },
};

const DOW_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  employeeId: string;
  tenantId: string;
  facilityId: string;
}

export default function MyFacilityShiftView({ employeeId, tenantId, facilityId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  /* 今月固定 (today 換算)。月セレクタなし */
  const { year, month } = useMemo(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, []);

  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [myFacilityIds, setMyFacilityIds] = useState<string[]>([]);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const today = todayStr();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      /* 自分の所属 facility 集合 (主 + 兼任先) を取得 */
      const facIds = await fetchMyFacilityIds(supabase, employeeId, facilityId);
      if (cancelled) return;

      const from = `${monthStr}-01`;
      const to = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

      /* RLS により、publish_status='published' かつ自分の facility のみ取得される */
      const [{ data: shiftData }, { data: empData }, { data: facData }] = await Promise.all([
        supabase
          .from('shift_assignments')
          .select('employee_id, facility_id, date, start_time, end_time, assignment_type, note')
          .in('facility_id', facIds)
          .eq('publish_status', 'published')
          .gte('date', from)
          .lte('date', to),
        supabase
          .from('employees')
          .select('id, last_name, first_name, facility_id')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .in('facility_id', facIds),
        supabase
          .from('facilities')
          .select('id, name')
          .in('id', facIds),
      ]);

      if (cancelled) return;
      setShifts((shiftData ?? []) as ShiftRow[]);
      setEmployees((empData ?? []) as EmployeeRow[]);
      setFacilities((facData ?? []) as FacilityRow[]);
      setMyFacilityIds(facIds);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [supabase, employeeId, facilityId, tenantId, monthStr, daysInMonth]);

  /* (employee_id, date) → ShiftRow ルックアップ */
  const shiftMap = useMemo(() => {
    const m = new Map<string, ShiftRow>();
    for (const s of shifts) m.set(`${s.employee_id}__${s.date}`, s);
    return m;
  }, [shifts]);

  /* 表示する社員は employees そのまま。並び順: 主所属 facility 順 → 名前順 */
  const sortedEmployees = useMemo(() => {
    const facOrder = new Map(facilities.map((f, i) => [f.id, i]));
    return [...employees].sort((a, b) => {
      const fa = a.facility_id ? (facOrder.get(a.facility_id) ?? 9999) : 9999;
      const fb = b.facility_id ? (facOrder.get(b.facility_id) ?? 9999) : 9999;
      if (fa !== fb) return fa - fb;
      const an = `${a.last_name} ${a.first_name}`;
      const bn = `${b.last_name} ${b.first_name}`;
      return an.localeCompare(bn, 'ja');
    });
  }, [employees, facilities]);

  const facNameById = useMemo(() => new Map(facilities.map((f) => [f.id, f.name])), [facilities]);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-diletto-gray">読み込み中...</div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="rounded-md bg-white border border-diletto-gray/10 p-8 text-center">
        <p className="text-sm text-diletto-gray">対象社員が見つかりません。</p>
      </div>
    );
  }

  /* 同 facility にシフトが 1 件も無い場合 (= まだ未公開) */
  if (shifts.length === 0) {
    return (
      <div className="rounded-md bg-white border border-diletto-gray/10 p-8 text-center">
        <p className="text-sm text-diletto-gray">
          {year}年{month}月の {myFacilityIds.length === 1 ? facilities[0]?.name : '所属事業所'} のシフトはまだ公開されていません。
        </p>
      </div>
    );
  }

  /* 日付ヘッダー (1..daysInMonth) */
  const dateList: { date: string; day: number; dow: number; isHoliday: boolean; holidayName: string | null }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dow = getDay(new Date(year, month - 1, d));
    const isHoliday = isJpHoliday(dateStr);
    dateList.push({
      date: dateStr,
      day: d,
      dow,
      isHoliday,
      holidayName: isHoliday ? jpHolidayName(dateStr) : null,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-diletto-ink">
          {year}年{month}月 — {myFacilityIds.length === 1 ? facilities[0]?.name : `所属事業所のシフト (${facilities.length} 施設)`}
        </h2>
        <span className="text-[10px] text-diletto-gray">公開済みのみ表示 / 表は読み取り専用</span>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-3 flex-wrap text-[10px]">
        {(Object.keys(TYPE_CONFIG) as ShiftAssignmentType[]).map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${TYPE_CONFIG[t].bg} ${TYPE_CONFIG[t].color}`}>
            {TYPE_CONFIG[t].label}
          </span>
        ))}
      </div>

      {/* 表 (横スクロール) */}
      <div className="rounded-md border border-diletto-gray/10 bg-white overflow-x-auto">
        <table className="text-xs border-collapse w-max min-w-full">
          <thead>
            <tr>
              <th
                className="sticky left-0 z-20 text-left px-3 py-2 font-bold whitespace-nowrap"
                style={{
                  background: '#f5f4f0',
                  boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                  minWidth: '160px',
                }}
              >
                社員
              </th>
              {dateList.map((d) => (
                <th
                  key={d.date}
                  className={`text-center px-1 py-2 font-medium whitespace-nowrap min-w-[56px] ${
                    d.date === today ? 'bg-diletto-blue/10' : ''
                  }`}
                  style={{
                    background: d.date === today ? undefined : '#f5f4f0',
                    boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                  }}
                >
                  <div className={`text-[10px] ${
                    d.isHoliday || d.dow === 0 ? 'text-diletto-red'
                    : d.dow === 6 ? 'text-diletto-blue'
                    : 'text-diletto-gray'
                  }`}>
                    {DOW_SHORT[d.dow]}
                  </div>
                  <div className={`text-sm font-bold ${
                    d.isHoliday || d.dow === 0 ? 'text-diletto-red'
                    : d.dow === 6 ? 'text-diletto-blue'
                    : 'text-diletto-ink'
                  }`}>
                    {d.day}
                  </div>
                  {d.isHoliday && (
                    <div className="text-[9px] text-diletto-red truncate" title={d.holidayName ?? ''}>
                      祝
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedEmployees.map((e) => (
              <tr key={e.id}>
                <td
                  className={`sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap ${
                    e.id === employeeId ? 'bg-diletto-blue/5' : 'bg-white'
                  }`}
                  style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                >
                  <div className="flex flex-col">
                    <span>{e.last_name} {e.first_name}{e.id === employeeId ? ' (あなた)' : ''}</span>
                    {myFacilityIds.length > 1 && e.facility_id && (
                      <span className="text-[9px] text-diletto-gray-light">{facNameById.get(e.facility_id) ?? ''}</span>
                    )}
                  </div>
                </td>
                {dateList.map((d) => {
                  const cell = shiftMap.get(`${e.id}__${d.date}`);
                  if (!cell) {
                    return (
                      <td
                        key={d.date}
                        className={`text-center px-1 py-1.5 ${d.date === today ? 'bg-diletto-blue/[0.03]' : ''}`}
                        style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                      >
                        <span className="text-diletto-gray-light/40">—</span>
                      </td>
                    );
                  }
                  const config = TYPE_CONFIG[cell.assignment_type];
                  const noteAttr = cell.note ? ` (📝 ${cell.note})` : '';
                  if (cell.assignment_type === 'normal' && cell.start_time && cell.end_time) {
                    return (
                      <td
                        key={d.date}
                        className={`text-center px-1 py-1.5 ${config.bg}`}
                        style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                        title={`出勤 ${cell.start_time.slice(0, 5)}〜${cell.end_time.slice(0, 5)}${noteAttr}`}
                      >
                        <div className={`text-[10px] font-medium ${config.color} leading-tight`}>
                          {cell.start_time.slice(0, 5)}
                        </div>
                        <div className={`text-[10px] ${config.color} leading-tight`}>
                          {cell.end_time.slice(0, 5)}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={d.date}
                      className={`text-center px-1 py-1.5 ${config.bg}`}
                      style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                      title={`${config.label}${noteAttr}`}
                    >
                      <span className={`text-[10px] font-bold ${config.color}`}>{config.label}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
