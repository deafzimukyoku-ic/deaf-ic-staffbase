'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, getDay, getDaysInMonth, startOfMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import MonthStepper from '@/components/shift/MonthStepper';
import Badge from '@/components/shift-compat/Badge';
import Modal from '@/components/shift-compat/Modal';
import Button from '@/components/shift-compat/Button';
import ShiftChangeRequestForm from '@/components/shift/ShiftChangeRequestForm';
import { createClient } from '@/lib/supabase/client';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';
import { todayStr } from '@/lib/date/isToday';
import type {
  ShiftAssignmentRow,
  ShiftAssignmentType,
  PublishStatus,
  ShiftChangeRequestRow,
} from '@/lib/types';

/**
 * 社員自身のシフト閲覧画面（/my/shifts）
 *
 * - publish_status='ready' / 'published' の自分のシフトを閲覧（migration 107 で許可済み）
 * - カレンダー型UIで月単位表示
 * - 各日クリックで詳細モーダル → 「この日について申請する」（タスクEのフォームへ）
 * - 既存 pending な変更申請は黄色バッジで強調
 */

interface ShiftCellRow {
  date: string;
  start_time: string | null;
  end_time: string | null;
  assignment_type: ShiftAssignmentType;
  publish_status: PublishStatus;
  note: string | null;
}

const TYPE_CONFIG: Record<ShiftAssignmentType, { label: string; bg: string; color: string; ring: string }> = {
  normal:        { label: '出勤', bg: 'bg-diletto-blue/5',   color: 'text-diletto-ink',  ring: 'ring-diletto-blue/40' },
  public_holiday:{ label: '公休', bg: 'bg-purple-50',         color: 'text-purple-700',   ring: 'ring-purple-300' },
  paid_leave:    { label: '有給', bg: 'bg-emerald-50',        color: 'text-emerald-700',  ring: 'ring-emerald-300' },
  off:           { label: '休み', bg: 'bg-gray-50',           color: 'text-diletto-gray', ring: 'ring-gray-200' },
};

function defaultCurrentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const DOW_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  /** ユーザーのemployee.id */
  employeeId: string;
  /** tenant_id（shift_change_requests INSERT に必要） */
  tenantId: string;
  /** ユーザーのfacility_id（自施設のみ閲覧可。RLSも同じ条件で絞られる） */
  facilityId: string;
}

export default function MyShiftsView({ employeeId, tenantId, facilityId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get('month');
  const { year, month } = useMemo(() => {
    const source = urlMonth && /^\d{4}-\d{2}$/.test(urlMonth) ? urlMonth : defaultCurrentMonthStr();
    const [y, m] = source.split('-').map(Number);
    return { year: y, month: m };
  }, [urlMonth]);

  const [loading, setLoading] = useState(true);
  const [cells, setCells] = useState<ShiftCellRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ShiftChangeRequestRow[]>([]);
  const [monthStatus, setMonthStatus] = useState<PublishStatus | 'mixed' | 'empty'>('empty');
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [requestFormDate, setRequestFormDate] = useState<string | null>(null);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const from = `${monthStr}-01`;
    const lastDay = getDaysInMonth(new Date(year, month - 1));
    const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

    // shift_assignments: RLS により自分の ready/published のみ取得される
    const { data: assigns } = await supabase
      .from('shift_assignments')
      .select('date, start_time, end_time, assignment_type, publish_status, note')
      .eq('facility_id', facilityId)
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });

    // 注意: 送迎担当（transport_assignments）は /my/shifts では一切取得・表示しない。
    // 児童氏名や同便職員などの個人情報を本人視点でも社員自身に見せない方針（個人情報配慮）。

    // 自分の保留中のシフト変更申請
    const { data: reqs } = await supabase
      .from('shift_change_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'pending')
      .gte('target_date', from)
      .lte('target_date', to);

    const cellRows = (assigns ?? []) as ShiftCellRow[];
    setCells(cellRows);
    setPendingRequests((reqs ?? []) as ShiftChangeRequestRow[]);

    // 集約ステータス
    if (cellRows.length === 0) {
      setMonthStatus('empty');
    } else {
      const statuses = new Set(cellRows.map((c) => c.publish_status));
      if (statuses.size === 1) setMonthStatus([...statuses][0] as PublishStatus);
      else setMonthStatus('mixed');
    }

    setLoading(false);
  }, [supabase, facilityId, employeeId, year, month, monthStr]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // 日付 → cell マップ
  const cellByDate = useMemo(() => {
    const m = new Map<string, ShiftCellRow>();
    for (const c of cells) m.set(c.date, c);
    return m;
  }, [cells]);

  const pendingByDate = useMemo(() => {
    const m = new Map<string, ShiftChangeRequestRow>();
    for (const r of pendingRequests) m.set(r.target_date, r);
    return m;
  }, [pendingRequests]);

  // カレンダーグリッド構築（日曜始まり）
  const weeks = useMemo(() => {
    const firstDay = startOfMonth(new Date(year, month - 1));
    const offset = getDay(firstDay); // 0(日)〜6(土)
    const daysInMonth = getDaysInMonth(firstDay);

    const cells: Array<{ date: string; day: number } | null> = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d,
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const ws: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) ws.push(cells.slice(i, i + 7));
    return ws;
  }, [year, month]);

  const today = todayStr();
  const openCell = openDate ? cellByDate.get(openDate) : null;
  const openPending = openDate ? pendingByDate.get(openDate) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <MonthStepper defaultMonth={defaultCurrentMonthStr()} />
          {monthStatus === 'published' && <Badge variant="success">公開中</Badge>}
          {monthStatus === 'ready' && <Badge variant="warning">仮シフト（確認中）</Badge>}
          {monthStatus === 'mixed' && <Badge variant="warning">部分公開</Badge>}
          {monthStatus === 'empty' && <Badge variant="neutral">未公開</Badge>}
        </div>
      </div>

      {monthStatus === 'ready' && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          📌 これは <strong>仮シフト</strong>です。問題があれば各日の詳細から「シフト変更申請」を提出してください。
        </div>
      )}

      {loading ? (
        <div className="h-64 flex items-center justify-center text-sm text-diletto-gray">読み込み中...</div>
      ) : monthStatus === 'empty' ? (
        <div className="rounded-md bg-white border border-diletto-gray/10 p-8 text-center">
          <p className="text-sm text-diletto-gray">
            {year}年{month}月のシフトはまだ公開されていません。
          </p>
        </div>
      ) : (
        <>
          {/* カレンダーヘッダー */}
          <div className="grid grid-cols-7 gap-1 text-xs font-bold text-center select-none">
            {DOW_SHORT.map((d, i) => (
              <div key={d} className={`py-1.5 ${i === 0 ? 'text-diletto-red' : i === 6 ? 'text-diletto-blue' : 'text-diletto-gray'}`}>
                {d}
              </div>
            ))}
          </div>

          {/* カレンダーグリッド */}
          <div className="grid grid-cols-7 gap-1">
            {weeks.flat().map((c, idx) => {
              if (!c) {
                return <div key={`empty-${idx}`} className="aspect-square sm:aspect-auto sm:min-h-[88px] bg-transparent" />;
              }
              const cell = cellByDate.get(c.date);
              const pending = pendingByDate.get(c.date);
              const isToday = c.date === today;
              const dow = getDay(new Date(c.date));
              const holiday = isJpHoliday(c.date);
              const config = cell ? TYPE_CONFIG[cell.assignment_type] : null;

              return (
                <button
                  key={c.date}
                  onClick={() => setOpenDate(c.date)}
                  className={`
                    relative text-left p-2 rounded-md border transition-all min-h-[88px]
                    ${isToday ? 'ring-2 ring-diletto-blue/40' : ''}
                    ${config ? `${config.bg} border-diletto-gray/10 hover:ring-1 ${config.ring}` : 'bg-white border-diletto-gray/10 hover:bg-diletto-blue/5'}
                  `}
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className={`text-xs font-bold ${
                      holiday || dow === 0 ? 'text-diletto-red' : dow === 6 ? 'text-diletto-blue' : 'text-diletto-ink'
                    }`}>
                      {c.day}
                    </span>
                    {pending && (
                      <span className="text-[9px] bg-amber-500 text-white px-1 rounded font-bold" title="申請中">
                        申請中
                      </span>
                    )}
                  </div>
                  {holiday && (
                    <div className="text-[9px] text-diletto-red mb-1 truncate" title={jpHolidayName(c.date) ?? ''}>
                      {jpHolidayName(c.date)}
                    </div>
                  )}
                  {cell ? (
                    <div className="space-y-0.5">
                      <div className={`text-xs font-bold ${config!.color}`}>
                        {config!.label}
                      </div>
                      {cell.assignment_type === 'normal' && cell.start_time && cell.end_time && (
                        <div className="text-[10px] text-diletto-gray">
                          {cell.start_time.slice(0, 5)}–{cell.end_time.slice(0, 5)}
                        </div>
                      )}
                      {cell.note && (
                        <div className="text-[10px] text-diletto-gray-light truncate" title={cell.note}>
                          📝 {cell.note}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px] text-diletto-gray-light">—</div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 詳細モーダル */}
      <Modal
        isOpen={!!openDate}
        onClose={() => setOpenDate(null)}
        title={openDate ? format(new Date(openDate), 'yyyy年M月d日（E）', { locale: ja }) : ''}
      >
        {openDate && (
          <div className="space-y-3">
            {openCell ? (
              <div className="rounded-md p-3 border border-diletto-gray/10">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`text-base font-bold ${TYPE_CONFIG[openCell.assignment_type].color}`}>
                    {TYPE_CONFIG[openCell.assignment_type].label}
                  </span>
                  {openCell.publish_status === 'ready' && <Badge variant="warning">仮</Badge>}
                  {openCell.publish_status === 'published' && <Badge variant="success">公開済</Badge>}
                </div>
                {openCell.assignment_type === 'normal' && openCell.start_time && openCell.end_time && (
                  <p className="text-sm text-diletto-ink mb-1">
                    勤務時間: <strong>{openCell.start_time.slice(0, 5)}〜{openCell.end_time.slice(0, 5)}</strong>
                  </p>
                )}
                {openCell.note && (
                  <p className="text-sm text-diletto-gray bg-diletto-beige rounded px-2 py-1 mt-2">
                    📝 {openCell.note}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-diletto-gray">この日のシフトはありません。</p>
            )}

            {openPending && (
              <div className="rounded-md p-3 bg-amber-50 border border-amber-200">
                <p className="text-xs font-bold text-amber-900 mb-1">📨 申請中</p>
                <p className="text-xs text-amber-800">
                  {openPending.change_type === 'time' && '時刻変更'}
                  {openPending.change_type === 'leave' && '休暇申請'}
                  {openPending.change_type === 'type_change' && '勤務種別変更'}
                  {openPending.reason && ` — ${openPending.reason}`}
                </p>
                <p className="text-[10px] text-amber-700 mt-1">承認待ち。重複した申請はできません。</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setOpenDate(null)}>
                閉じる
              </Button>
              {!openPending && openCell && (
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    setRequestFormDate(openDate);
                    setOpenDate(null);
                  }}
                >
                  この日について申請する
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* シフト変更申請フォーム（タスクE） */}
      {requestFormDate && (
        <ShiftChangeRequestForm
          isOpen={!!requestFormDate}
          onClose={() => setRequestFormDate(null)}
          onSubmitted={() => { void fetchAll(); }}
          tenantId={tenantId}
          facilityId={facilityId}
          employeeId={employeeId}
          targetDate={requestFormDate}
          currentShift={(() => {
            const c = cellByDate.get(requestFormDate);
            return c ? {
              assignment_type: c.assignment_type,
              start_time: c.start_time,
              end_time: c.end_time,
            } : null;
          })()}
        />
      )}
    </div>
  );
}
