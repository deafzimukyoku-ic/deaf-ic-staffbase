'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, getDay, getDaysInMonth, startOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import MonthStepper from '@/components/shift/MonthStepper';
import Badge from '@/components/shift-compat/Badge';
import Button from '@/components/shift-compat/Button';
import { createClient } from '@/lib/supabase/client';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';
import { todayStr } from '@/lib/date/isToday';
import ShiftChangeRequestForm from '@/components/shift/ShiftChangeRequestForm';
import type { ShiftRequestRow, ShiftRequestType, ShiftAssignmentType } from '@/lib/types';

/**
 * 自分の休み希望提出カレンダー（タスクC）
 *
 * - 各日に status を設定: none / public_holiday / paid_leave / full_day_available / am_off / pm_off
 * - 「保存する」で shift_requests に upsert（既存の自分の月行を全部消して入れ直し）
 * - shift_request_comments は使わない（案Z で削除済み）
 * - 既に shift がready/published になった月は提出不可（読み取り専用）
 */

type DayStatus = 'none' | ShiftRequestType;

const SELECTABLE: Exclude<DayStatus, 'none' | 'comment'>[] = [
  'requested_off',
  'paid_leave',
  'full_day_available',
  'am_off',
  'pm_off',
];

// shift-puzzle 風: 各 status のドット用 hex / セル背景 / 枠線
const STATUS_CONFIG: Record<Exclude<DayStatus, 'none' | 'comment'>, {
  label: string;
  bg: string;       // セル背景（淡色）
  color: string;    // テキスト色
  border: string;   // セル枠線
  dot: string;      // 凡例ドット背景
  dotBorder: string;// 凡例ドット枠
  swatchBg: string; // AM/PM 半月塗り用 hex （rgb 系）
}> = {
  requested_off:      { label: '希望休',    bg: 'bg-purple-50',  color: 'text-purple-700',  border: 'border-purple-400',  dot: 'bg-purple-100',  dotBorder: 'border-purple-400',  swatchBg: 'rgb(243 232 255)' },
  paid_leave:         { label: '有給',      bg: 'bg-emerald-50', color: 'text-emerald-700', border: 'border-emerald-400', dot: 'bg-emerald-100', dotBorder: 'border-emerald-400', swatchBg: 'rgb(209 250 229)' },
  full_day_available: { label: '1日出勤可', bg: 'bg-amber-50',   color: 'text-amber-700',   border: 'border-amber-400',   dot: 'bg-amber-100',   dotBorder: 'border-amber-400',   swatchBg: 'rgb(254 243 199)' },
  am_off:             { label: 'AM休',     bg: 'bg-blue-50',    color: 'text-blue-700',    border: 'border-blue-400',    dot: 'bg-blue-100',    dotBorder: 'border-blue-400',    swatchBg: 'rgb(219 234 254)' },
  pm_off:             { label: 'PM休',     bg: 'bg-indigo-50',  color: 'text-indigo-700',  border: 'border-indigo-400',  dot: 'bg-indigo-100',   dotBorder: 'border-indigo-400',  swatchBg: 'rgb(224 231 255)' },
};

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function nextMonthStr(): string {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}

interface Props {
  employeeId: string;
  tenantId: string;
  facilityId: string;
}

export default function MyRequestsView({ employeeId, tenantId, facilityId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get('month');
  const targetMonth = useMemo(() => {
    return urlMonth && /^\d{4}-\d{2}$/.test(urlMonth) ? urlMonth : nextMonthStr();
  }, [urlMonth]);
  const [year, monthNum] = targetMonth.split('-').map(Number);

  const [dayStatuses, setDayStatuses] = useState<Record<string, DayStatus>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  /* readOnly(締切)時に日付タップで開く「シフト変更申請」用: 自分の確定シフト + 基本勤務時間 */
  const [dateShiftMap, setDateShiftMap] = useState<Record<string, { assignment_type: ShiftAssignmentType; start_time: string | null; end_time: string | null }>>({});
  const [myDefaults, setMyDefaults] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [changeReq, setChangeReq] = useState<{ date: string; currentShift: { assignment_type: ShiftAssignmentType; start_time: string | null; end_time: string | null } | null } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 既存の希望
      const { data: reqs } = await supabase
        .from('shift_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('month', targetMonth);

      const map: Record<string, DayStatus> = {};
      const allNotes: string[] = [];
      for (const r of (reqs ?? []) as ShiftRequestRow[]) {
        for (const d of r.dates) map[d] = r.request_type;
        if (r.notes) allNotes.push(r.notes);
      }
      setDayStatuses(map);
      setNotes(allNotes.join(' / '));

      // 既にシフトが ready/published になっていたら締切扱い（読み取り専用）
      const from = `${targetMonth}-01`;
      const lastDay = getDaysInMonth(new Date(year, monthNum - 1));
      const to = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
      const { data: assigns } = await supabase
        .from('shift_assignments')
        .select('publish_status')
        .eq('facility_id', facilityId)
        .gte('date', from)
        .lte('date', to)
        .limit(1);
      const isPublished = (assigns ?? []).some(
        (a: { publish_status: string }) => a.publish_status === 'ready' || a.publish_status === 'published'
      );
      setReadOnly(isPublished);

      /* 自分の確定シフト（変更申請モーダルの現状表示用）+ 基本勤務時間。
         readOnly のとき日付タップで ShiftChangeRequestForm に渡す。 */
      const [{ data: myShifts }, { data: me }] = await Promise.all([
        supabase
          .from('shift_assignments')
          .select('date, assignment_type, start_time, end_time')
          .eq('employee_id', employeeId)
          .in('publish_status', ['ready', 'published'])
          .gte('date', from)
          .lte('date', to),
        supabase.from('employees').select('default_start_time, default_end_time').eq('id', employeeId).maybeSingle(),
      ]);
      const sMap: Record<string, { assignment_type: ShiftAssignmentType; start_time: string | null; end_time: string | null }> = {};
      for (const s of (myShifts ?? []) as { date: string; assignment_type: ShiftAssignmentType; start_time: string | null; end_time: string | null }[]) {
        sMap[s.date] = { assignment_type: s.assignment_type, start_time: s.start_time, end_time: s.end_time };
      }
      setDateShiftMap(sMap);
      setMyDefaults({ start: (me?.default_start_time as string | null) ?? null, end: (me?.default_end_time as string | null) ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, employeeId, targetMonth, year, monthNum, facilityId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  /* readOnly(締切)時: 日付タップでその日のシフト変更申請モーダルを開く */
  const openChangeRequest = (date: string) => {
    setChangeReq({ date, currentShift: dateShiftMap[date] ?? null });
  };

  // カレンダーグリッド構築
  const weeks = useMemo(() => {
    const firstDay = startOfMonth(new Date(year, monthNum - 1));
    const offset = getDay(firstDay);
    const daysInMonth = getDaysInMonth(firstDay);
    const cells: Array<{ date: string; day: number } | null> = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        date: `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d,
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const ws: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) ws.push(cells.slice(i, i + 7));
    return ws;
  }, [year, monthNum]);

  const today = todayStr();

  const setStatus = (date: string, status: DayStatus) => {
    setDayStatuses((prev) => {
      const next = { ...prev };
      if (status === 'none') delete next[date];
      else next[date] = status;
      return next;
    });
    setEditingDay(null);
  };

  // 一括: 全日曜を希望休
  const setAllSundaysPublic = () => {
    const next = { ...dayStatuses };
    for (const week of weeks) {
      for (const c of week) {
        if (!c) continue;
        const dow = getDay(new Date(c.date));
        if (dow === 0) next[c.date] = 'requested_off';
      }
    }
    setDayStatuses(next);
  };

  // 一括: クリア
  const clearAll = () => {
    if (!confirm('全ての設定をクリアしますか？')) return;
    setDayStatuses({});
  };

  // 保存（全消し→入れ直し）
  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // 1. 既存を全削除
      const { error: delErr } = await supabase
        .from('shift_requests')
        .delete()
        .eq('employee_id', employeeId)
        .eq('month', targetMonth);
      if (delErr) throw new Error('既存の希望を削除できません: ' + delErr.message);

      // 2. status ごとに dates を集約して insert
      const groups = new Map<ShiftRequestType, string[]>();
      for (const [date, status] of Object.entries(dayStatuses)) {
        if (status === 'none') continue;
        const arr = groups.get(status) ?? [];
        arr.push(date);
        groups.set(status, arr);
      }

      if (groups.size > 0) {
        const trimmedNotes = notes.trim() || null;
        const rows = Array.from(groups, ([request_type, dates]) => ({
          tenant_id: tenantId,
          facility_id: facilityId,
          employee_id: employeeId,
          month: targetMonth,
          request_type,
          dates: dates.sort(),
          notes: trimmedNotes,
          submitted_by: employeeId,
        }));
        const { error: insErr } = await supabase.from('shift_requests').insert(rows);
        if (insErr) throw new Error('保存失敗: ' + insErr.message);
      }

      setSavedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-64 flex items-center justify-center text-sm text-brand-gray">読み込み中...</div>;
  }

  // 各 status の日数
  const statusCounts = SELECTABLE.reduce<Record<string, number>>((acc, s) => {
    acc[s] = Object.values(dayStatuses).filter((v) => v === s).length;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <MonthStepper defaultMonth={nextMonthStr()} />
          {readOnly && <Badge variant="warning">締切（シフト作成済）</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {savedAt && !error && (
            <span className="text-xs text-emerald-700">
              ✓ {format(new Date(savedAt), 'HH:mm:ss', { locale: ja })} に保存
            </span>
          )}
          {!readOnly && (
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存する'}
            </Button>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          📌 この月は既にシフトが作成されています。変更したい場合は<strong>下のカレンダーの日付</strong>（または「施設のシフト」タブの自分の勤務）をタップして<strong>シフト変更申請</strong>をしてください。
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* 凡例＋件数バッジ（統合: 公休 0日 など枠付き） */}
      <div className="flex flex-wrap gap-2 items-center">
        {SELECTABLE.map((s) => {
          const cfg = STATUS_CONFIG[s];
          return (
            <span key={s} className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
              {cfg.label} {statusCounts[s]}日
            </span>
          );
        })}
        {!readOnly && (
          <>
            <button onClick={setAllSundaysPublic} className="ml-auto text-xs px-2 py-1 rounded border border-brand-gray/20 text-brand-gray hover:bg-brand-blue/5">
              日曜を一括「希望休」に
            </button>
            <button onClick={clearAll} className="text-xs px-2 py-1 rounded border border-brand-gray/20 text-brand-gray hover:bg-brand-red/5">
              クリア
            </button>
          </>
        )}
      </div>

      {/* カレンダーカード */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {DOW.map((d, i) => (
            <div key={d} className={`text-center text-xs font-semibold py-1 ${i === 0 ? 'text-brand-red' : i === 6 ? 'text-brand-blue' : 'text-brand-gray-light'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* グリッド */}
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((c, idx) => {
            if (!c) return <div key={`empty-${idx}`} />;

            const status = dayStatuses[c.date] ?? 'none';
            const cfg = status !== 'none' && status !== 'comment' ? STATUS_CONFIG[status] : null;
            const isToday = c.date === today;
            const dow = getDay(new Date(c.date));
            const holiday = isJpHoliday(c.date);
            const isEditing = editingDay === c.date;
            const isWeekend = dow === 0 || dow === 6;

            // セル背景: AM/PM 半月塗りは inline style、その他は bg class
            let bgStyle: React.CSSProperties | undefined;
            if (status === 'am_off') {
              bgStyle = { background: `linear-gradient(to bottom, ${STATUS_CONFIG.am_off.swatchBg} 0 50%, transparent 50% 100%)` };
            } else if (status === 'pm_off') {
              bgStyle = { background: `linear-gradient(to bottom, transparent 0 50%, ${STATUS_CONFIG.pm_off.swatchBg} 50% 100%)` };
            }
            const useGradient = status === 'am_off' || status === 'pm_off';

            const numberColor = holiday || dow === 0 ? 'text-brand-red' : dow === 6 ? 'text-brand-blue' : 'text-brand-ink';

            return (
              <div key={c.date} className="relative">
                <button
                  onClick={() => (readOnly ? openChangeRequest(c.date) : setEditingDay(isEditing ? null : c.date))}
                  title={readOnly ? 'タップしてシフト変更申請' : holiday ? jpHolidayName(c.date) ?? undefined : undefined}
                  className={`
                    w-full flex flex-col items-center justify-center py-2 rounded-md transition-all active:scale-95 border-[1.5px]
                    ${useGradient ? 'border-blue-400' : cfg ? `${cfg.bg} ${cfg.border}` : isWeekend || holiday ? 'bg-black/[0.02] border-transparent' : 'bg-white border-transparent'}
                    ${isToday ? 'ring-2 ring-brand-blue/40' : ''}
                    cursor-pointer hover:brightness-95
                  `}
                  style={{ minHeight: '52px', ...(bgStyle ?? {}) }}
                >
                  <span className={`text-sm font-semibold ${numberColor}`}>{c.day}</span>
                  {cfg && (
                    <span className={`text-[10px] font-bold mt-0.5 ${cfg.color}`}>{cfg.label}</span>
                  )}
                </button>

                {/* インラインピッカー: 木〜土のセルは right-0 にして画面右端の見切れ防止（モバイル対応） */}
                {isEditing && !readOnly && (
                  <div className={`absolute z-30 top-full mt-1 w-56 p-2 rounded-md shadow-lg bg-white border border-brand-gray/15 ${dow >= 4 ? 'right-0' : 'left-0'}`}>
                    <div className="text-[11px] font-bold mb-1.5 text-brand-gray">
                      {format(new Date(c.date), 'M月d日(E)', { locale: ja })}
                    </div>
                    <div className="grid grid-cols-1 gap-1">
                      {SELECTABLE.map((s) => {
                        const pCfg = STATUS_CONFIG[s];
                        const isActive = status === s;
                        return (
                          <button
                            key={s}
                            onClick={() => setStatus(c.date, s)}
                            className={`flex items-center gap-2 text-left px-2 py-1.5 text-xs rounded transition border ${pCfg.border} ${pCfg.color} ${
                              isActive ? `${pCfg.bg} font-bold` : 'bg-white hover:bg-gray-50'
                            }`}
                          >
                            <span className={`w-2.5 h-2.5 rounded-full ${pCfg.dot} border ${pCfg.dotBorder}`} />
                            {pCfg.label}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setStatus(c.date, 'none')}
                        className="text-left px-2 py-1.5 text-xs rounded text-brand-gray hover:bg-brand-red/5 mt-1 border-t border-brand-gray/10 pt-2"
                      >
                        ✕ 設定をクリア
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>


      {/* 全体メモ */}
      <div className="space-y-1">
        <label className="text-xs font-bold text-brand-gray-light">補足メモ（任意）</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          disabled={readOnly}
          placeholder="特記事項があれば記入してください（例: 月末の通院予定など）"
          className="w-full text-sm rounded-md px-3 py-2 bg-white border border-brand-gray/15 outline-none focus:border-brand-blue/40 disabled:bg-gray-50"
        />
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存する'}
          </Button>
        </div>
      )}

      {changeReq && (
        <ShiftChangeRequestForm
          isOpen
          onClose={() => setChangeReq(null)}
          onSubmitted={() => { /* フォームがトースト表示。閉じるは onClose に委譲 */ }}
          tenantId={tenantId}
          facilityId={facilityId}
          employeeId={employeeId}
          targetDate={changeReq.date}
          currentShift={changeReq.currentShift}
          defaultStartTime={myDefaults.start}
          defaultEndTime={myDefaults.end}
        />
      )}
    </div>
  );
}
