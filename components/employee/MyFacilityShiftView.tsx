'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { addMonths, format, getDaysInMonth, getDay, subMonths } from 'date-fns';
import MonthStepper from '@/components/shift/MonthStepper';
import ShiftConfirmButton from '@/components/shift/ShiftConfirmButton';
import ShiftChangeRequestForm from '@/components/shift/ShiftChangeRequestForm';
import { createClient } from '@/lib/supabase/client';
import { isJpHoliday, jpHolidayName } from '@/lib/date/holidays';
import { todayStr } from '@/lib/date/isToday';
import { fetchMyFacilityIds, fetchAllRows, fetchFacilityShiftViewEmployees } from '@/lib/multi-facility';
import type { ShiftAssignmentType } from '@/lib/types';

/**
 * 社員: 自分の所属 facility (主所属 + 兼任先) の published シフトを表で表示。
 *
 * - /my/requests ページの「施設のシフト」タブ用 (休み希望と同居)
 * - URL ?month=YYYY-MM で対象月を制御 (facility-shift-month-navigation 仕様)
 * - 月送り範囲: 現在月 ± 1 ヶ月 (前月/今月/翌月) のみ。範囲外 URL は今月にフォールバック
 * - 表形式: 行 = 同 facility の active 社員、列 = 日付 (対象月)
 * - セル = 出勤時刻 or 公休/希望休/有給/休み のラベル (色分け)
 * - 読み取り専用。published のみ (RLS で migration 160 が許可)
 *
 * RLS: sa_employee_facility_shifts (migration 160) により
 *   - get_my_facility_ids() に含まれる facility の
 *   - publish_status='published' の shift_assignments を全社員分 SELECT 可能
 */

function thisMonthStr(): string {
  return format(new Date(), 'yyyy-MM');
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const next = delta > 0 ? addMonths(d, delta) : subMonths(d, -delta);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

interface ShiftRow {
  employee_id: string;
  facility_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  assignment_type: ShiftAssignmentType;
  note: string | null;
  publish_status: 'ready' | 'published';
}

interface EmployeeRow {
  id: string;
  last_name: string;
  first_name: string;
  facility_id: string | null;
  shift_display_order: number | null;
  default_start_time: string | null;
  default_end_time: string | null;
}

interface FacilityRow {
  id: string;
  name: string;
}

const TYPE_CONFIG: Record<ShiftAssignmentType, { label: string; bg: string; color: string }> = {
  normal:         { label: '出勤',   bg: 'bg-brand-blue/5',   color: 'text-brand-ink' },
  public_holiday: { label: '公休',   bg: 'bg-purple-50',        color: 'text-purple-700' },
  requested_off:  { label: '希望休', bg: 'bg-amber-50',         color: 'text-amber-700' },
  paid_leave:     { label: '有給',   bg: 'bg-emerald-50',       color: 'text-emerald-700' },
  off:            { label: '休み',   bg: 'bg-gray-50',          color: 'text-brand-gray' },
  /* 半休（migration 218）: AM休=午後勤務 / PM休=午前勤務 */
  am_off:         { label: 'AM休',   bg: 'bg-blue-50',          color: 'text-blue-700' },
  pm_off:         { label: 'PM休',   bg: 'bg-indigo-50',        color: 'text-indigo-700' },
};

const DOW_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  employeeId: string;
  tenantId: string;
  facilityId: string;
}

export default function MyFacilityShiftView({ employeeId, tenantId, facilityId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  /* 今月が未公開でも公開済みの月(通常は翌月)を初期表示にするためのスマート既定。
     URL ?month= が明示されていればそちらを最優先する。 */
  const [smartDefault, setSmartDefault] = useState<string | null>(null);
  /* URL ?month=YYYY-MM 駆動。範囲外 / 不正値は スマート既定 → 今月 にフォールバック */
  const { year, month, thisMonth, prevMonth, nextMonth } = useMemo(() => {
    const thisMonth = thisMonthStr();
    const prevMonth = shiftMonth(thisMonth, -1);
    const nextMonth = shiftMonth(thisMonth, +1);
    const allowed = [prevMonth, thisMonth, nextMonth];
    const urlMonth = searchParams.get('month');
    const isValidFmt = !!urlMonth && /^\d{4}-\d{2}$/.test(urlMonth);
    /* 優先順位: URL 明示 > 公開済み最新月(smartDefault) > 今月 */
    const target = isValidFmt && allowed.includes(urlMonth!)
      ? urlMonth!
      : (smartDefault ?? thisMonth);
    const [y, m] = target.split('-').map(Number);
    return { year: y, month: m, thisMonth, prevMonth, nextMonth };
  }, [searchParams, smartDefault]);

  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [myFacilityIds, setMyFacilityIds] = useState<string[]>([]);
  /* 自分の勤務セルをタップしたときに開く「シフト変更申請」モーダルの対象 */
  const [changeReq, setChangeReq] = useState<{
    date: string;
    facilityId: string;
    currentShift: { assignment_type: ShiftAssignmentType; start_time: string | null; end_time: string | null } | null;
  } | null>(null);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const today = todayStr();

  /* 初回: URL に month が無い場合のみ、所属 facility の公開済み月を調べて
     公開済みの最新月(窓内: 前月/今月/翌月)を初期表示に採用する。
     「翌月公開・今月未公開」でも開いた瞬間に公開済みシフトが見えるようにする。 */
  useEffect(() => {
    if (searchParams.get('month')) return;
    let cancelled = false;
    (async () => {
      const facIds = await fetchMyFacilityIds(supabase, employeeId, facilityId);
      if (cancelled || facIds.length === 0) return;
      /* 上限は nextMonth の翌月 1 日（排他境界）。`${nextMonth}-31` は 30/29/28 日月で
         無効日付になり Postgres がクエリエラー → smartDefault 不発になる不具合を回避。 */
      const [ny, nm] = nextMonth.split('-').map(Number);
      const afterNext = nm === 12 ? `${ny + 1}-01-01` : `${ny}-${String(nm + 1).padStart(2, '0')}-01`;
      const { data } = await supabase
        .from('shift_assignments')
        .select('date')
        .in('facility_id', facIds)
        .eq('publish_status', 'published')
        .gte('date', `${prevMonth}-01`)
        .lt('date', afterNext);
      if (cancelled) return;
      const months = new Set((data ?? []).map((r: { date: string }) => r.date.slice(0, 7)));
      /* 翌月 > 今月 > 前月 の優先で、公開済みが存在する最新月を採用 */
      const preferred = [nextMonth, thisMonth, prevMonth].find((mm) => months.has(mm));
      if (preferred && preferred !== thisMonth) setSmartDefault(preferred);
    })();
    return () => { cancelled = true; };
    /* 初回マウント時の facility/window で 1 度だけ評価する（URL month 明示時は無効） */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, employeeId, facilityId, prevMonth, thisMonth, nextMonth]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      /* 自分の所属 facility 集合 (主 + 兼任先) を取得 */
      const facIds = await fetchMyFacilityIds(supabase, employeeId, facilityId);
      if (cancelled) return;

      /* facId が空のまま .in('facility_id', []) を投げると PostgREST が `in.()` を
         400 で拒否し、表が「読み込み中」で固まる。所属施設が無い (例: 施設未設定の
         閲覧者) ときは空表示で確定させる。 */
      if (facIds.length === 0) {
        setShifts([]); setEmployees([]); setFacilities([]); setMyFacilityIds([]); setLoading(false);
        return;
      }

      const from = `${monthStr}-01`;
      const to = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

      /* RLS（migration 160 拡張）により、publish_status in (ready, published) かつ
         自分の facility のみ取得される。ready は「仮（確認中）」として表示する。
         shift_assignments は兼任(複数 facility × 1ヶ月)で 1000 行を超えうるため
         fetchAllRows でページング取得し、PostgREST の暗黙 max-rows(1000) 打ち切りを回避する
         （2026-06-01 「兼任職員の表が途中までしか出ない」バグの修正）。

         employees は RLS が「自分のみ」かつ get_facility_members RPC が employee 役割を弾いて
         いるため、直接 SELECT すると自分しか返らない。migration 217 で追加した SECURITY DEFINER
         RPC `get_my_facility_shift_view_employees` を経由して同 facility の同僚を取得する。
         戻り値は機密情報を含まない最小列 (id / 氏名 / facility / 並び順 / 既定開始終了)。 */
      const [shiftData, empData, { data: facData }] = await Promise.all([
        fetchAllRows<ShiftRow>(() =>
          supabase
            .from('shift_assignments')
            .select('employee_id, facility_id, date, start_time, end_time, assignment_type, note, publish_status')
            .in('facility_id', facIds)
            .in('publish_status', ['ready', 'published'])
            .gte('date', from)
            .lte('date', to)
            .order('date', { ascending: true }),
        ),
        fetchFacilityShiftViewEmployees(supabase, facIds),
        supabase
          .from('facilities')
          .select('id, name')
          .in('id', facIds),
      ]);

      if (cancelled) return;
      setShifts(shiftData);
      /* RPC 戻り値の last_name / first_name は nullable だが、表示前提として空文字で埋める。 */
      setEmployees(empData.map((e) => ({
        id: e.id,
        last_name: e.last_name ?? '',
        first_name: e.first_name ?? '',
        facility_id: e.facility_id,
        shift_display_order: e.shift_display_order,
        default_start_time: e.default_start_time,
        default_end_time: e.default_end_time,
      })));
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

  /* 並び順: 施設順（兼任で複数施設のときのグループ化）→ 送迎表と同じ
     shift_display_order ASC（NULLS LAST）→ 氏名。職員管理 DnD の並びがそのまま反映される。 */
  const sortedEmployees = useMemo(() => {
    const facOrder = new Map(facilities.map((f, i) => [f.id, i]));
    return [...employees].sort((a, b) => {
      const fa = a.facility_id ? (facOrder.get(a.facility_id) ?? 9999) : 9999;
      const fb = b.facility_id ? (facOrder.get(b.facility_id) ?? 9999) : 9999;
      if (fa !== fb) return fa - fb;
      const ao = a.shift_display_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.shift_display_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'ja');
    });
  }, [employees, facilities]);

  const facNameById = useMemo(() => new Map(facilities.map((f) => [f.id, f.name])), [facilities]);

  /* 当月の段階（ready が 1 件でもあれば「仮」、全て published なら「公開」）と、
     確認対象の施設集合（当月に ready/published シフトがある施設）を算出。 */
  const { monthStage, facilityIdsWithShifts } = useMemo(() => {
    const facSet = new Set<string>();
    let hasReady = false;
    let hasPublished = false;
    for (const s of shifts) {
      facSet.add(s.facility_id);
      if (s.publish_status === 'ready') hasReady = true;
      else if (s.publish_status === 'published') hasPublished = true;
    }
    const stage: 'ready' | 'published' | null = hasReady ? 'ready' : hasPublished ? 'published' : null;
    return { monthStage: stage, facilityIdsWithShifts: Array.from(facSet) };
  }, [shifts]);

  /* 自分の行の勤務セルをタップ → その日のシフト変更申請モーダルを開く。
     facility は当該セルの施設（兼任時に正しい施設で申請するため）。空セルは未設定として申請可。 */
  const openChangeRequest = (date: string, cell: ShiftRow | null) => {
    setChangeReq({
      date,
      facilityId: cell?.facility_id ?? facilityId,
      currentShift: cell
        ? { assignment_type: cell.assignment_type, start_time: cell.start_time, end_time: cell.end_time }
        : null,
    });
  };

  /* 月送りはどの状態でも常に表示するため、ローディング / 空 / 未公開状態は inline で描画 (return しない) */
  const stateBlock = loading ? (
    <div className="h-64 flex items-center justify-center text-sm text-brand-gray">読み込み中...</div>
  ) : employees.length === 0 ? (
    <div className="rounded-md bg-white border border-brand-gray/10 p-8 text-center">
      <p className="text-sm text-brand-gray">対象社員が見つかりません。</p>
    </div>
  ) : shifts.length === 0 ? (
    <div className="rounded-md bg-white border border-brand-gray/10 p-8 text-center">
      <p className="text-sm text-brand-gray">
        {year}年{month}月の {myFacilityIds.length === 1 ? facilities[0]?.name : '所属事業所'} のシフトはまだ公開されていません。
      </p>
    </div>
  ) : null;

  /* state がある時 (loading / 空 / 未公開) は MonthStepper + 状態ブロック だけ表示。それ以外は表本体まで描画 */
  if (stateBlock) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <MonthStepper minMonth={prevMonth} maxMonth={nextMonth} defaultMonth={monthStr} />
        </div>
        {stateBlock}
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
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-brand-ink">
            {year}年{month}月 — {myFacilityIds.length === 1 ? facilities[0]?.name : `所属事業所のシフト (${facilities.length} 施設)`}
          </h2>
          {monthStage === 'ready' && (
            <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">仮（確認中）</span>
          )}
          {monthStage === 'published' && (
            <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">公開済み</span>
          )}
        </div>
        {monthStage && facilityIdsWithShifts.length > 0 && (
          <ShiftConfirmButton
            tenantId={tenantId}
            employeeId={employeeId}
            facilityIds={facilityIdsWithShifts}
            month={monthStr}
            stage={monthStage}
          />
        )}
      </div>
      {monthStage === 'ready' && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900">
          これは<strong>仮シフト</strong>です。内容を確認し、問題があれば「シフト変更申請」からご連絡ください。確認したら「確認しました」を押してください。
        </div>
      )}

      {/* 月送り (現在月 ± 1 ヶ月制限) */}
      <div className="flex items-center gap-2 flex-wrap">
        <MonthStepper minMonth={prevMonth} maxMonth={nextMonth} defaultMonth={monthStr} />
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-3 flex-wrap text-[10px]">
        {(Object.keys(TYPE_CONFIG) as ShiftAssignmentType[]).map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${TYPE_CONFIG[t].bg} ${TYPE_CONFIG[t].color}`}>
            {TYPE_CONFIG[t].label}
          </span>
        ))}
      </div>

      {monthStage && (
        <p className="text-[11px] text-brand-gray-light">💡 自分の勤務（あなたの行）をタップすると、その日の<strong>シフト変更申請</strong>ができます。</p>
      )}

      {/* 表 (横スクロール) */}
      <div className="rounded-md border border-brand-gray/10 bg-white overflow-x-auto">
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
                    d.date === today ? 'bg-brand-blue/10' : ''
                  }`}
                  style={{
                    background: d.date === today ? undefined : '#f5f4f0',
                    boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                  }}
                >
                  <div className={`text-[10px] ${
                    d.isHoliday || d.dow === 0 ? 'text-brand-red'
                    : d.dow === 6 ? 'text-brand-blue'
                    : 'text-brand-gray'
                  }`}>
                    {DOW_SHORT[d.dow]}
                  </div>
                  <div className={`text-sm font-bold ${
                    d.isHoliday || d.dow === 0 ? 'text-brand-red'
                    : d.dow === 6 ? 'text-brand-blue'
                    : 'text-brand-ink'
                  }`}>
                    {d.day}
                  </div>
                  {d.isHoliday && (
                    <div className="text-[9px] text-brand-red truncate" title={d.holidayName ?? ''}>
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
                  className="sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap"
                  style={{
                    /* 固定列は必ず不透明背景で覆う。半透明 (bg-brand-blue/5) だと横スクロール時に
                       後ろのデータセル（希望休 等）が透けて文字が重なって見える。 */
                    background: e.id === employeeId ? '#eef2fb' : '#ffffff',
                    boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)',
                  }}
                >
                  <div className="flex flex-col">
                    <span>{e.last_name} {e.first_name}{e.id === employeeId ? ' (あなた)' : ''}</span>
                    {myFacilityIds.length > 1 && e.facility_id && (
                      <span className="text-[9px] text-brand-gray-light">{facNameById.get(e.facility_id) ?? ''}</span>
                    )}
                  </div>
                </td>
                {dateList.map((d) => {
                  const cell = shiftMap.get(`${e.id}__${d.date}`);
                  /* 自分の行のセルはタップで変更申請モーダルを開く（他人の行は不可） */
                  const isOwn = e.id === employeeId;
                  const ownClick = isOwn ? () => openChangeRequest(d.date, cell ?? null) : undefined;
                  const ownCls = isOwn ? ' cursor-pointer hover:ring-2 hover:ring-inset hover:ring-brand-blue/50' : '';
                  if (!cell) {
                    return (
                      <td
                        key={d.date}
                        className={`text-center px-1 py-1.5 ${d.date === today ? 'bg-brand-blue/[0.03]' : ''}${ownCls}`}
                        style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                        onClick={ownClick}
                        title={isOwn ? 'タップしてシフト変更申請' : undefined}
                      >
                        <span className="text-brand-gray-light/40">—</span>
                      </td>
                    );
                  }
                  const config = TYPE_CONFIG[cell.assignment_type];
                  const noteAttr = cell.note ? ` (📝 ${cell.note})` : '';
                  if (cell.assignment_type === 'normal' && cell.start_time && cell.end_time) {
                    return (
                      <td
                        key={d.date}
                        className={`text-center px-1 py-1.5 ${config.bg}${ownCls}`}
                        style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                        title={`出勤 ${cell.start_time.slice(0, 5)}〜${cell.end_time.slice(0, 5)}${noteAttr}${isOwn ? ' / タップして変更申請' : ''}`}
                        onClick={ownClick}
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
                      className={`text-center px-1 py-1.5 ${config.bg}${ownCls}`}
                      style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                      title={`${config.label}${noteAttr}${isOwn ? ' / タップして変更申請' : ''}`}
                      onClick={ownClick}
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

      {changeReq && (
        <ShiftChangeRequestForm
          isOpen
          onClose={() => setChangeReq(null)}
          onSubmitted={() => { /* 送信成功時はフォームがトースト表示。閉じるは onClose に委譲 */ }}
          tenantId={tenantId}
          facilityId={changeReq.facilityId}
          employeeId={employeeId}
          targetDate={changeReq.date}
          currentShift={changeReq.currentShift}
          defaultStartTime={employees.find((x) => x.id === employeeId)?.default_start_time ?? null}
          defaultEndTime={employees.find((x) => x.id === employeeId)?.default_end_time ?? null}
        />
      )}
    </div>
  );
}
