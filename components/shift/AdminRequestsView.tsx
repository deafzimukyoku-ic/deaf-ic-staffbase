'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, getDay, getDaysInMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import MonthStepper from '@/components/shift/MonthStepper';
import Modal from '@/components/shift-compat/Modal';
import Badge from '@/components/shift-compat/Badge';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import { staffDisplayName } from '@/lib/shift-utils';
import { fetchFacilityMembers } from '@/lib/multi-facility';
import { isJpHoliday } from '@/lib/date/holidays';
import type { ShiftRequestRow, ShiftRequestType } from '@/lib/types';

/**
 * admin/mgr 用 休み希望一覧（タスクC-2）
 * - 月選択 + 該当月の facility 内 employees の希望サマリ
 * - 行クリックで本人別の日別カレンダー詳細
 * - 代理入力は実装しない（要件外）
 */

const TYPE_LABEL: Record<ShiftRequestType, string> = {
  public_holiday: '公休',
  paid_leave: '有給',
  full_day_available: '1日出勤可',
  am_off: 'AM休',
  pm_off: 'PM休',
  comment: 'コメント',
};

const TYPE_COLOR: Record<ShiftRequestType, string> = {
  public_holiday:     'bg-purple-100 text-purple-800',
  paid_leave:         'bg-emerald-100 text-emerald-800',
  full_day_available: 'bg-amber-100 text-amber-800',
  am_off:             'bg-blue-100 text-blue-800',
  pm_off:             'bg-indigo-100 text-indigo-800',
  comment:            'bg-red-100 text-red-800',
};

function nextMonthStr(): string {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}

interface EmployeeRow {
  id: string;
  name: string;
  employment_type: 'full_time' | 'part_time' | null;
}

interface Props {
  /** admin の場合は false（facility をヘッダーセレクタから取得）。manager は自施設に固定される */
  forceFacilityId?: string | null;
}

export default function AdminRequestsView({ forceFacilityId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get('month');
  const targetMonth = useMemo(() => (
    urlMonth && /^\d{4}-\d{2}$/.test(urlMonth) ? urlMonth : nextMonthStr()
  ), [urlMonth]);
  const [year, monthNum] = targetMonth.split('-').map(Number);

  const [headerFacilityId] = useShiftFacilityId();
  const facilityId = forceFacilityId ?? headerFacilityId;

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [requests, setRequests] = useState<ShiftRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // migration 130: 兼任先 (employee_facilities) の職員も含めて取得
    // migration 155: SECURITY DEFINER RPC で employees の RLS をバイパス（manager / shift_manager 対応）
    const allMembers = await fetchFacilityMembers(supabase, facilityId);

    if (allMembers.length === 0) {
      setEmployees([]);
      setRequests([]);
      setLoading(false);
      return;
    }

    /* 本部などシフトのみモードの事業所には admin ロールの社員も在籍するため、role フィルタを撤去。
       「自分が休み希望を提出する」運用は role に関係なく可能。 */
    const memberIds = allMembers.map((m) => m.id);
    const empRows: EmployeeRow[] = allMembers
      .filter((m) => m.status === 'active')
      .sort((a, b) => {
        const ao = a.shift_display_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.shift_display_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return (a.last_name ?? '').localeCompare(b.last_name ?? '', 'ja');
      })
      .map((e) => ({
        id: e.id,
        name: staffDisplayName({ last_name: e.last_name ?? '', first_name: e.first_name ?? '' }),
        employment_type: (e.employment_type ?? null) as 'full_time' | 'part_time' | null,
      }));

    /* 兼任職員の他施設で出された希望も「両方の管理者が見える」要件のため、
       facility_id 絞り込みを employee_id 絞り込みに置換 (migration 131 の RLS と整合) */
    const { data: reqs } = await supabase
      .from('shift_requests')
      .select('*')
      .in('employee_id', memberIds)
      .eq('month', targetMonth);

    setEmployees(empRows);
    setRequests((reqs ?? []) as ShiftRequestRow[]);
    setLoading(false);
  }, [supabase, facilityId, targetMonth]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // employee_id ごとに集計
  const summaryByEmployee = useMemo(() => {
    const m = new Map<string, { reqs: ShiftRequestRow[]; counts: Record<ShiftRequestType, number>; submitted: boolean; submittedAt: string | null }>();
    for (const e of employees) {
      m.set(e.id, {
        reqs: [],
        counts: { public_holiday: 0, paid_leave: 0, full_day_available: 0, am_off: 0, pm_off: 0, comment: 0 },
        submitted: false,
        submittedAt: null,
      });
    }
    for (const r of requests) {
      const entry = m.get(r.employee_id);
      if (!entry) continue;
      entry.reqs.push(r);
      entry.counts[r.request_type] += r.dates.length;
      entry.submitted = true;
      if (!entry.submittedAt || (r.submitted_at && r.submitted_at > entry.submittedAt)) {
        entry.submittedAt = r.submitted_at;
      }
    }
    return m;
  }, [employees, requests]);

  const detailEmployee = detailEmployeeId ? employees.find((e) => e.id === detailEmployeeId) : null;
  const detailSummary = detailEmployeeId ? summaryByEmployee.get(detailEmployeeId) : null;

  if (!facilityId) {
    return (
      <div className="p-6">
        <p className="text-sm text-diletto-gray">事業所を上部から選択してください。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <MonthStepper defaultMonth={nextMonthStr()} />
        <Badge variant="neutral">提出済 {[...summaryByEmployee.values()].filter((v) => v.submitted).length} / {employees.length}</Badge>
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center text-sm text-diletto-gray">読み込み中...</div>
      ) : employees.length === 0 ? (
        <div className="rounded-md bg-white border border-diletto-gray/10 p-6 text-center text-sm text-diletto-gray">
          職員がいません
        </div>
      ) : (
        /* PC でもカード表示（モバイル UI 流用、大画面では中央寄せで読みやすく） */
        <ul className="space-y-2 max-w-4xl mx-auto w-full">
          {employees.map((e) => {
            const sum = summaryByEmployee.get(e.id)!;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setDetailEmployeeId(e.id)}
                  className="w-full text-left rounded-md border border-diletto-gray/10 bg-white p-3 active:bg-diletto-blue/5 hover:bg-diletto-blue/[0.02] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="font-bold text-sm md:text-base truncate">{e.name}</span>
                      <span className="text-[11px] md:text-xs text-diletto-gray">
                        {e.employment_type === 'full_time' ? '常勤' : e.employment_type === 'part_time' ? 'パート' : '-'}
                      </span>
                    </div>
                    {sum.submitted ? <Badge variant="success">提出済</Badge> : <Badge variant="neutral">未提出</Badge>}
                  </div>
                  <div className="grid grid-cols-5 gap-1 md:gap-2 text-center">
                    {([
                      ['公休', sum.counts.public_holiday, 'bg-purple-50 text-purple-700'],
                      ['有給', sum.counts.paid_leave, 'bg-emerald-50 text-emerald-700'],
                      ['出勤可', sum.counts.full_day_available, 'bg-amber-50 text-amber-700'],
                      ['AM休', sum.counts.am_off, 'bg-blue-50 text-blue-700'],
                      ['PM休', sum.counts.pm_off, 'bg-indigo-50 text-indigo-700'],
                    ] as const).map(([label, count, cls]) => (
                      <div key={label} className={`rounded px-1 py-1 md:py-1.5 ${cls}`}>
                        <div className="text-[10px] md:text-xs font-bold leading-tight">{label}</div>
                        <div className="text-sm md:text-base font-bold tabular-nums leading-tight">{count}</div>
                      </div>
                    ))}
                  </div>
                  {sum.submittedAt && (
                    <div className="mt-2 text-[10px] md:text-xs text-diletto-gray-light tabular-nums text-right">
                      提出: {format(new Date(sum.submittedAt), 'M/d HH:mm')}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 詳細モーダル */}
      <Modal
        isOpen={!!detailEmployee}
        onClose={() => setDetailEmployeeId(null)}
        title={detailEmployee ? `${detailEmployee.name} の休み希望（${year}年${monthNum}月）` : ''}
      >
        {detailEmployee && detailSummary && (
          <div className="space-y-3">
            {detailSummary.reqs.length === 0 ? (
              <p className="text-sm text-diletto-gray">未提出</p>
            ) : (
              <>
                <DetailCalendar reqs={detailSummary.reqs} year={year} monthNum={monthNum} />
                {detailSummary.reqs.some((r) => r.notes) && (
                  <div className="rounded-md bg-diletto-beige p-2 text-xs">
                    <div className="font-bold mb-0.5">補足メモ</div>
                    {detailSummary.reqs.filter((r) => r.notes).map((r) => (
                      <div key={r.id}>{r.notes}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailCalendar({ reqs, year, monthNum }: { reqs: ShiftRequestRow[]; year: number; monthNum: number }) {
  // date → request_type
  const map = new Map<string, ShiftRequestType>();
  for (const r of reqs) for (const d of r.dates) map.set(d, r.request_type);

  const firstDay = new Date(year, monthNum - 1, 1);
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

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px] font-bold text-center">
        {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
          <div key={d} className={`py-1 ${i === 0 ? 'text-diletto-red' : i === 6 ? 'text-diletto-blue' : 'text-diletto-gray'}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => {
          if (!c) return <div key={`e-${i}`} className="min-h-[44px]" />;
          const t = map.get(c.date);
          const dow = getDay(new Date(c.date));
          const holiday = isJpHoliday(c.date);
          return (
            <div key={c.date} className={`min-h-[44px] p-1 rounded border border-diletto-gray/10 ${t ? TYPE_COLOR[t] : 'bg-white'}`}>
              <div className={`text-[11px] font-bold ${
                holiday || dow === 0 ? 'text-diletto-red' : dow === 6 ? 'text-diletto-blue' : ''
              }`}>{c.day}</div>
              {t && <div className="text-[9px] font-bold mt-0.5">{TYPE_LABEL[t]}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
