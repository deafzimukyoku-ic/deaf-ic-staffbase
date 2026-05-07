'use client';

/**
 * 職員 × 児童 同席日数（月次） — Phase F
 *
 * 仕様（CLAUDE.md / docs/progress.html Phase F 確定）:
 * - 出勤判定: shift_assignments で start_time/end_time 両方あり、assignment_type='normal'
 * - 児童利用判定: schedule_entries で (pickup_time OR dropoff_time) が not null、
 *   attendance_status NOT IN ('absent', 'leave', 'waitlist')
 * - 重複判定: 同日かつ時間帯が重なる
 *   max(staff_start, child_pickup or 00:00) < min(staff_end, child_dropoff or 23:59:59)
 * - 1事業所単位で集計
 * - 行=児童、列=職員、セル=同席日数
 * - A4 横で印刷
 *
 * パフォーマンス:
 * 1ヶ月あたり typically: 30 children × 30 days = 900 schedule_entries,
 * 30 staff × 25 days = 750 shift_assignments → 全て in-memory で結合可能
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { getDaysInMonth } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import { fetchFacilityMemberIds } from '@/lib/multi-facility';
import { staffDisplayName } from '@/lib/shift-utils';
import { isAttended } from '@/lib/logic/attendance';
import Button from '@/components/shift-compat/Button';
import type { Facility } from '@/lib/types';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
}

interface StaffCol {
  id: string;
  name: string;
}

interface ChildRowR {
  id: string;
  name: string;
}

/** "HH:MM:SS" or "HH:MM" → 秒数 (NaN なら null) */
function toSec(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h < 0 || h > 24 || mn < 0 || mn >= 60) return null;
  return h * 3600 + mn * 60 + s;
}

function defaultMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

interface ShiftRow {
  employee_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
}

interface EntryRow {
  child_id: string;
  date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  attendance_status: string;
}

export default function StaffChildOverlapView({ scope }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [me, setMe] = useState<MeRow | null>(null);
  const [shiftFacilityId] = useShiftFacilityId();
  const facilityId =
    scope === 'manager' ? me?.facility_id ?? '' : shiftFacilityId ?? '';
  const [{ year, month }, setYM] = useState(() => defaultMonth());
  const [facility, setFacility] = useState<Facility | null>(null);
  const [staff, setStaff] = useState<StaffCol[]>([]);
  const [children, setChildren] = useState<ChildRowR[]>([]);
  /** counts[childId][staffId] = 同席日数 */
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hideZeroRows, setHideZeroRows] = useState(false);
  const [hideZeroCols, setHideZeroCols] = useState(false);

  const monthFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthTo = `${year}-${String(month).padStart(2, '0')}-${String(getDaysInMonth(new Date(year, month - 1))).padStart(2, '0')}`;

  const loadMe = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (data) setMe(data as MeRow);
  }, [supabase]);

  const fetchAll = useCallback(async () => {
    if (!me || !facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      /* facility 名（印刷ヘッダ用） */
      const { data: facData } = await supabase
        .from('facilities')
        .select('*')
        .eq('id', facilityId)
        .single();
      setFacility((facData ?? null) as Facility | null);

      /* 当該 facility の所属職員 ID（兼任 employee_facilities 含む / migration 130） */
      const memberIds = await fetchFacilityMemberIds(supabase, facilityId);
      if (memberIds.length === 0) {
        setStaff([]);
        setChildren([]);
        setCounts({});
        setLoading(false);
        return;
      }

      /* 職員一覧 (active のみ)。employees に display_name 列は無いので select しない（migration 0 系の構造のまま） */
      const { data: staffData } = await supabase
        .from('employees')
        .select('id, last_name, first_name, shift_display_order, status')
        .in('id', memberIds)
        .eq('status', 'active')
        .order('shift_display_order', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true });
      const staffRows: StaffCol[] = (staffData ?? []).map((e) => ({
        id: e.id,
        name: staffDisplayName({
          last_name: e.last_name,
          first_name: e.first_name,
        }),
      }));

      /* 児童一覧（在籍 + 当該 facility） */
      const { data: childData } = await supabase
        .from('children')
        .select('id, name, display_order, is_active')
        .eq('facility_id', facilityId)
        .eq('is_active', true)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
      const childRows: ChildRowR[] = (childData ?? []).map((c) => ({
        id: c.id,
        name: c.name,
      }));

      /* 当月の shift_assignments（実勤務 + 時間あり） */
      const { data: shiftData } = await supabase
        .from('shift_assignments')
        .select('employee_id, date, start_time, end_time, assignment_type')
        .eq('facility_id', facilityId)
        .gte('date', monthFrom)
        .lte('date', monthTo)
        .eq('assignment_type', 'normal')
        .not('start_time', 'is', null)
        .not('end_time', 'is', null);

      /* 当月の schedule_entries（出席判定通過分のみ JS でフィルタ） */
      const { data: entryData } = await supabase
        .from('schedule_entries')
        .select('child_id, date, pickup_time, dropoff_time, attendance_status')
        .eq('facility_id', facilityId)
        .gte('date', monthFrom)
        .lte('date', monthTo);

      const shifts = (shiftData ?? []) as ShiftRow[];
      /* 出席判定は lib/logic/attendance.ts の isAttended に一元化（時間あり ∧ ¬waitlist）*/
      const entries = ((entryData ?? []) as EntryRow[]).filter(isAttended);

      /* date → shifts[] / date → entries[] にバケット化 */
      const shiftsByDate = new Map<string, ShiftRow[]>();
      for (const s of shifts) {
        const arr = shiftsByDate.get(s.date) ?? [];
        arr.push(s);
        shiftsByDate.set(s.date, arr);
      }
      const entriesByDate = new Map<string, EntryRow[]>();
      for (const e of entries) {
        const arr = entriesByDate.get(e.date) ?? [];
        arr.push(e);
        entriesByDate.set(e.date, arr);
      }

      /* 各日の (staff, child) ペアで時間重複判定 → カウント加算 */
      const matrix: Record<string, Record<string, number>> = {};
      for (const [date, daySh] of shiftsByDate) {
        const dayEn = entriesByDate.get(date);
        if (!dayEn || dayEn.length === 0) continue;
        for (const sh of daySh) {
          const ss = toSec(sh.start_time);
          const se = toSec(sh.end_time);
          if (ss == null || se == null || se <= ss) continue;
          for (const en of dayEn) {
            /* 児童側の時間範囲: pickup〜dropoff。片方欠けたら open-ended（00:00 / 23:59:59）扱い */
            const cs = toSec(en.pickup_time) ?? 0;
            const ce = toSec(en.dropoff_time) ?? 23 * 3600 + 59 * 60 + 59;
            if (ce <= cs) continue;
            /* 区間重複: max(start) < min(end) */
            if (Math.max(ss, cs) < Math.min(se, ce)) {
              const inner = matrix[en.child_id] ?? (matrix[en.child_id] = {});
              inner[sh.employee_id] = (inner[sh.employee_id] ?? 0) + 1;
            }
          }
        }
      }

      setStaff(staffRows);
      setChildren(childRows);
      setCounts(matrix);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, me, facilityId, monthFrom, monthTo]);

  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  function changeMonth(delta: number) {
    setYM(({ year: y, month: m }) => {
      const next = new Date(y, m - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  }

  /* 行/列の合計とフィルタ */
  const childTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of children) {
      const inner = counts[c.id] ?? {};
      t[c.id] = Object.values(inner).reduce((a, b) => a + b, 0);
    }
    return t;
  }, [children, counts]);

  const staffTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const s of staff) t[s.id] = 0;
    for (const c of children) {
      const inner = counts[c.id] ?? {};
      for (const [sid, n] of Object.entries(inner)) {
        if (t[sid] != null) t[sid] += n;
      }
    }
    return t;
  }, [staff, children, counts]);

  const visibleChildren = useMemo(
    () => (hideZeroRows ? children.filter((c) => (childTotals[c.id] ?? 0) > 0) : children),
    [children, childTotals, hideZeroRows],
  );
  const visibleStaff = useMemo(
    () => (hideZeroCols ? staff.filter((s) => (staffTotals[s.id] ?? 0) > 0) : staff),
    [staff, staffTotals, hideZeroCols],
  );

  /* 計列を撤去したため grandTotal は不要 */

  return (
    <div className="flex flex-col gap-3 -m-6 lg:-m-8 p-6 lg:p-8 h-full overflow-auto">
      {/* 印刷専用 CSS: A4 横、ボタン非表示 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A4 landscape; margin: 8mm; }
              body { background: white; }
              .print-hide { display: none !important; }
              .overlap-grid th, .overlap-grid td {
                border: 0.4pt solid #000 !important;
                font-size: 9pt;
              }
              .overlap-grid thead th { background: #f0f0f0 !important; -webkit-print-color-adjust: exact; }
              .overlap-print-title { display: block !important; }
            }
            @media screen { .overlap-print-title { display: none; } }
          `,
        }}
      />

      <h1 className="overlap-print-title text-base font-bold mb-2">
        職員×児童 同席日数表 — {facility?.name ?? ''} {year}年{month}月分
      </h1>

      <div className="flex items-center justify-between flex-wrap gap-3 print-hide mb-1">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
          👥 職員×児童 同席日数
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => changeMonth(-1)}>‹ 前の月</Button>
          <div
            className="px-3 py-1.5 rounded font-bold whitespace-nowrap"
            style={{ background: 'var(--white)', border: '1.5px solid var(--accent)', color: 'var(--ink)', minWidth: '110px', textAlign: 'center' }}
          >
            {year}年{month}月
          </div>
          <Button variant="secondary" onClick={() => changeMonth(1)}>次の月 ›</Button>
          <Button variant="secondary" onClick={() => window.print()}>🖨 A4横で印刷</Button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs print-hide" style={{ color: 'var(--ink-2)' }}>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={hideZeroRows} onChange={(e) => setHideZeroRows(e.target.checked)} />
          0回の児童を非表示
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={hideZeroCols} onChange={(e) => setHideZeroCols(e.target.checked)} />
          0回の職員を非表示
        </label>
        <span className="ml-auto" style={{ color: 'var(--ink-3)' }}>
          ※ 同席 = 同じ日に職員のシフト時間と児童の利用時間が重なった日数
        </span>
      </div>

      {error && (
        <div className="px-4 py-2 rounded mb-2 print-hide" style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {!facilityId ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>事業所が選択されていません。</div>
      ) : loading ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>読み込み中...</div>
      ) : visibleChildren.length === 0 || visibleStaff.length === 0 ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>
          {children.length === 0 ? '児童が登録されていません。'
            : staff.length === 0 ? '職員が登録されていません。'
            : '表示対象がありません（0回非表示が有効になっている可能性があります）。'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--rule-strong)', background: 'var(--white)' }}>
          <table
            className="w-full text-sm overlap-grid"
            style={{ borderCollapse: 'collapse', minWidth: `${140 + visibleStaff.length * 64}px` }}
          >
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th className="px-2 py-2 text-left font-semibold whitespace-nowrap sticky left-0 z-10" style={{ background: 'var(--bg)', minWidth: '140px' }}>児童名</th>
                {visibleStaff.map((s) => (
                  <th key={s.id} className="px-1 py-2 text-center font-semibold whitespace-nowrap" style={{ minWidth: '56px', maxWidth: '80px' }} title={s.name}>
                    <div style={{ fontSize: s.name.length > 5 ? '0.7rem' : '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleChildren.map((c, idx) => {
                const inner = counts[c.id] ?? {};
                return (
                  <tr key={c.id} style={{ background: idx % 2 === 1 ? 'rgba(0,0,0,0.02)' : undefined }}>
                    <td className="px-2 py-2 font-semibold whitespace-nowrap sticky left-0 z-10" style={{ background: idx % 2 === 1 ? '#f6f6f5' : 'var(--white)' }}>{c.name}</td>
                    {visibleStaff.map((s) => {
                      const n = inner[s.id] ?? 0;
                      return (
                        <td key={s.id} className="px-1 py-2 text-center" style={{ fontVariantNumeric: 'tabular-nums', color: n > 0 ? 'var(--ink)' : 'var(--ink-3)', fontWeight: n > 0 ? 600 : 400 }}>
                          {n > 0 ? n : ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* 合計行（職員ごとの月内同席日数合計） */}
              <tr style={{ background: 'var(--bg)', fontWeight: 700, borderTop: '1.2pt solid #000' }}>
                <td className="px-2 py-2 text-right whitespace-nowrap sticky left-0 z-10" style={{ background: 'var(--bg)' }}>合計</td>
                {visibleStaff.map((s) => (
                  <td key={s.id} className="px-1 py-2 text-center" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {staffTotals[s.id] || ''}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
