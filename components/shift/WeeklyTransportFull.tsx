'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, getDaysInMonth } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import Button from '@/components/shift-compat/Button';
import MonthStepper from '@/components/shift/MonthStepper';
import { staffDisplayName } from '@/lib/shift-utils';
import { resolveEntryTransportSpec } from '@/lib/shift-logic/resolveTransportSpec';
import { isAttended } from '@/lib/logic/attendance';
import { fetchFacilityMembers, type FacilityMemberRow } from '@/lib/multi-facility';
import type {
  StaffRow,
  ChildRow,
  ScheduleEntryRow,
  TransportAssignmentRow,
  AreaLabel,
} from '@/lib/types';

/**
 * 送迎表 週次印刷ページ（deaf-ic 版） — shift-puzzle Phase 47/52 を忠実移植。
 *
 * 主な差分:
 *  - tenant 単独 → tenant + facility 二重スコープ（useShiftFacilityId）
 *  - 全 fetch を supabase client 直叩きに変更（RLS で facility 単位に絞られる）
 *  - staff_id → employee_id, pickup/dropoff_staff_ids → pickup/dropoff_employee_ids
 *  - useCurrentStaff() / isDateOutOfRange() への依存を削除（deaf-ic は employee 側 RLS）
 *  - tenant_settings.pickup_areas → facility_shift_settings.pickup_area_labels
 *  - 「ShiftPuzzle 送迎表」表記 → 「deaf-ic 送迎表」
 *
 * 仕様温存:
 *  - 月単位データを「月曜始まり 7 日」固定週で分割（buildWeeklyGrid）
 *  - 1 週間 = A3 縦 1 ページ（@page size A3 portrait + page-break-after: always）
 *  - 7 日 ×（1 見出し + 12 行 = 13 行）= 91 行 を A3 縦 1 枚に強制収納
 *  - 月外日付も「対象外」として薄く表示（曜日位置を揃える）
 *  - 欠席 (absent)・お休み (leave / 時刻両方 null) は印刷対象外
 *  - 児童名・場所列・時刻列・迎担当・送担当列のレイアウト
 *  - 場所マーク絵文字を担当列に転記（誰が何便を担当したか視認しやすく）
 */

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** Phase 47: 月の各日が含まれる週（月曜始まり 7 日）を返す。
 *  各週は常に「月-日 の 7 日」固定。月外の日付は string で持ち、
 *  描画側で「対象月外」として扱う（空ブロック表示）。
 *  これにより全週ページのレイアウトが揃い、同じ曜日が常に同じ位置に来る。 */
function buildWeeklyGrid(year: number, month: number): { weeks: { date: string; inMonth: boolean }[][] } {
  const monthStart = new Date(year, month - 1, 1);
  const monthEndDay = new Date(year, month, 0).getDate();
  /* 1日が含まれる週の月曜を起点にする */
  const dow = monthStart.getDay(); /* 0=Sun..6=Sat */
  const offsetToMonday = dow === 0 ? -6 : 1 - dow; /* 月曜まで戻る日数 */
  const cursor = new Date(year, month - 1, 1 + offsetToMonday);

  const weeks: { date: string; inMonth: boolean }[][] = [];
  while (true) {
    const week: { date: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const d = cursor.getDate();
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      week.push({ date: dateStr, inMonth: m === month });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    /* 1 週進めて、その週の最初の日が翌月の月末以降なら終了 */
    const firstOfNextWeek = new Date(cursor);
    if (firstOfNextWeek.getMonth() + 1 !== month && firstOfNextWeek.getDate() > 7) break;
    /* 安全弁: 6 週超えたら break（カレンダー上限） */
    if (weeks.length >= 6) break;
    /* この月の日が 1 つもない週なら終了 */
    if (week.every((d) => !d.inMonth) && week[0].date.split('-')[2] !== '01') break;
    /* 残りの月内日数があるかチェック */
    const lastInWeek = week[6];
    const [, lm, ld] = lastInWeek.date.split('-').map(Number);
    if (lm > month || (lm === month && ld >= monthEndDay)) break;
  }
  return { weeks };
}

/** Phase 52 (rev): 1 日あたりの固定枠数。
 *  7 日 ×（1 見出し + 12 行）= 91 行を A3 縦 1 枚に収めるため、
 *  フォント・パディング・行ギャップを print CSS で強く圧縮する前提で 12 固定に戻した。 */
const SLOTS_PER_DAY = 12;

interface Props {
  /** 'admin' or 'manager'。employee は来ない想定 */
  role: 'admin' | 'manager';
}

export default function WeeklyTransportFull({ role: _role }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [facilityId] = useShiftFacilityId();

  const searchParams = useSearchParams();
  const urlMonth = searchParams.get('month');
  const { year, month } = useMemo(() => {
    const now = new Date();
    const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const source = urlMonth && /^\d{4}-\d{2}$/.test(urlMonth) ? urlMonth : fallback;
    const [y, m] = source.split('-').map(Number);
    return { year: y, month: m };
  }, [urlMonth]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryRow[]>([]);
  const [transportAssignments, setTransportAssignments] = useState<TransportAssignmentRow[]>([]);
  const [pickupAreas, setPickupAreas] = useState<AreaLabel[]>([]);
  const [dropoffAreas, setDropoffAreas] = useState<AreaLabel[]>([]);

  const daysInMonth = getDaysInMonth(new Date(year, month - 1));

  const fetchAll = useCallback(async () => {
    if (!facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

      // 職員一覧は SECURITY DEFINER RPC 経由（migration 155）。RLS バイパスで manager / shift_manager でも全員取得可能
      const allMembers = await fetchFacilityMembers(supabase, facilityId);
      const empRows: FacilityMemberRow[] = allMembers
        .filter((m) => m.status === 'active')
        .sort((a, b) => {
          const ao = a.shift_display_order ?? Number.MAX_SAFE_INTEGER;
          const bo = b.shift_display_order ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return (a.last_name ?? '').localeCompare(b.last_name ?? '', 'ja');
        });

      const [childRes, entryRes, transportRes, settingsRes] = await Promise.all([
        supabase.from('children').select('*').eq('facility_id', facilityId),
        supabase
          .from('schedule_entries')
          .select('*')
          .eq('facility_id', facilityId)
          .gte('date', from)
          .lte('date', to),
        supabase
          .from('transport_assignments')
          .select('*')
          .eq('facility_id', facilityId),
        supabase
          .from('facility_shift_settings')
          .select('pickup_area_labels, dropoff_area_labels')
          .eq('facility_id', facilityId)
          .maybeSingle(),
      ]);

      const staffRows: StaffRow[] = empRows.map((e) => ({
        id: e.id,
        tenant_id: e.tenant_id,
        facility_id: e.facility_id ?? '',
        name: `${e.last_name ?? ''} ${e.first_name ?? ''}`.trim(),
        email: e.email,
        role: (e.role as 'admin' | 'manager' | 'employee') ?? 'employee',
        employment_type: (e.employment_type as 'full_time' | 'part_time') ?? 'full_time',
        default_start_time: e.default_start_time,
        default_end_time: e.default_end_time,
        pickup_transport_areas: e.pickup_transport_areas ?? [],
        dropoff_transport_areas: e.dropoff_transport_areas ?? [],
        qualifications: e.qualifications ?? [],
        shift_qualifications: e.shift_qualifications ?? e.qualifications ?? [],
        is_qualified: e.is_qualified ?? false,
        is_driver: e.is_driver ?? false,
        is_attendant: e.is_attendant ?? false,
        shift_display_order: e.shift_display_order,
      }));
      setStaff(staffRows);
      setChildren((childRes.data ?? []) as ChildRow[]);

      /* 出席判定は isAttended (時間あり ∧ ¬waitlist) に一元化。waitlist は送迎担当を持たないので除外。 */
      setScheduleEntries(
        ((entryRes.data ?? []) as ScheduleEntryRow[]).filter(isAttended),
      );

      /* transport_assignments を当月分の schedule_entry_id で絞る */
      const entryIdSet = new Set(((entryRes.data ?? []) as ScheduleEntryRow[]).map((e) => e.id));
      setTransportAssignments(
        ((transportRes.data ?? []) as TransportAssignmentRow[]).filter((t) =>
          entryIdSet.has(t.schedule_entry_id),
        ),
      );

      const settings = settingsRes.data ?? null;
      setPickupAreas((settings?.pickup_area_labels as AreaLabel[]) ?? []);
      setDropoffAreas((settings?.dropoff_area_labels as AreaLabel[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [supabase, facilityId, year, month, daysInMonth]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const { weeks } = useMemo(() => buildWeeklyGrid(year, month), [year, month]);
  const childById = useMemo(() => new Map(children.map((c) => [c.id, c])), [children]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const childOrder = useMemo(
    () => new Map(children.map((c, i) => [c.id, c.display_order ?? i])),
    [children],
  );
  const assignByEntry = useMemo(
    () => new Map(transportAssignments.map((t) => [t.schedule_entry_id, t])),
    [transportAssignments],
  );

  /* 1 日分の表示行を構築 */
  const buildDayRows = useCallback(
    (date: string) => {
      const entries = scheduleEntries.filter((e) => e.date === date);
      return entries
        .map((e) => {
          const spec = resolveEntryTransportSpec(e, {
            child: childById.get(e.child_id),
            pickupAreas,
            dropoffAreas,
          });
          const t = assignByEntry.get(e.id);
          const pickupStaffNames = (t?.pickup_employee_ids ?? [])
            .map((id) => {
              const s = staffById.get(id);
              return s ? staffDisplayName(s) || s.name : '';
            })
            .filter(Boolean)
            .join('・');
          const dropoffStaffNames = (t?.dropoff_employee_ids ?? [])
            .map((id) => {
              const s = staffById.get(id);
              return s ? staffDisplayName(s) || s.name : '';
            })
            .filter(Boolean)
            .join('・');
          return {
            entryId: e.id,
            childName: childById.get(e.child_id)?.name ?? '(不明)',
            /* 場所表示: 迎/送のラベル + 時刻 */
            pickupLabel: spec.pickup.areaLabel ?? '',
            dropoffLabel: spec.dropoff.areaLabel ?? '',
            pickupTime: spec.pickup.time ?? e.pickup_time ?? '',
            dropoffTime: spec.dropoff.time ?? e.dropoff_time ?? '',
            pickupMethod: e.pickup_method,
            dropoffMethod: e.dropoff_method,
            pickupStaffNames,
            dropoffStaffNames,
            childOrder: childOrder.get(e.child_id) ?? Number.MAX_SAFE_INTEGER,
          };
        })
        .sort((a, b) => a.childOrder - b.childOrder);
    },
    [scheduleEntries, childById, pickupAreas, dropoffAreas, assignByEntry, staffById, childOrder],
  );

  const handlePrint = () => {
    const original = document.title;
    document.title = `週次送迎_${year}-${String(month).padStart(2, '0')}`;
    const restore = () => {
      document.title = original;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  };

  return (
    /* 親レイアウト (admin/manager) の p-6 lg:p-8 を打ち消して縦横をフルに使う。
       シフト表 / 利用表 / 送迎表 / 日次出力 と padding を統一。 */
    <div className="flex flex-col h-full overflow-hidden -m-6 lg:-m-8 weekly-transport-print-root">
      {/* Phase 47 / 52 (rev): 週次送迎表の印刷 CSS。1 週 = A3 縦 1 ページに強制収納。
         7 日 ×（1 見出し + 12 行）= 91 行を A3 縦（420mm）に収める前提で、
         @page 余白・フォント・padding・day-block 間ギャップ・h2 を全圧縮。 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A3 portrait; margin: 4mm; }
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .weekly-transport-print-root { overflow: visible !important; height: auto !important; }
              .weekly-transport-print-root .weekly-scroll { overflow: visible !important; padding: 0 !important; background: #fff !important; }
              aside, header, .weekly-print-toolbar { display: none !important; }
              .week-page {
                page-break-after: always; break-after: page;
                padding: 2mm !important; margin: 0 !important; border: none !important;
                background: #fff !important;
              }
              .week-page:last-child { page-break-after: auto; break-after: auto; }
              .week-page > div:first-child { margin-bottom: 1mm !important; }
              .week-page h2 { font-size: 10pt !important; line-height: 1.1 !important; }
              .week-page > div:first-child > span { font-size: 7pt !important; }
              /* 週全体のコンテナは縦スクロールなしで詰める */
              .weekly-transport-print-root .flex.flex-col.gap-6 { gap: 0 !important; }
              /* 各日ブロック間のギャップを最小化 */
              .day-block { page-break-inside: avoid; break-inside: avoid; margin-bottom: 0 !important; }
              /* テーブル自体をコンパクトに */
              .week-page table { font-size: 7pt !important; line-height: 1.15 !important; border-collapse: collapse !important; }
              .week-page th, .week-page td {
                padding: 0.5px 3px !important;
                line-height: 1.15 !important;
                height: auto !important;
              }
              .week-page thead th { font-size: 7pt !important; padding: 1px 3px !important; }
            }
          `,
        }}
      />

      {/* MonthStepper + 印刷ボタンを 1 行で（利用表/シフト表/送迎表/日次出力 と統一） */}
      <div className="weekly-print-toolbar px-6 pt-1 pb-1.5 flex items-center justify-between gap-3 flex-wrap">
        <MonthStepper />
        <Button variant="primary" onClick={handlePrint}>
          🖨 印刷 / PDF保存
        </Button>
      </div>

      <div className="weekly-scroll flex-1 overflow-auto px-6 py-3" style={{ background: 'var(--white)' }}>
        {!facilityId && (
          <p className="text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
            ヘッダーから事業所を選択してください。
          </p>
        )}
        {error && (
          <div
            className="mb-4 px-4 py-2 rounded"
            style={{ background: 'var(--red-pale)', color: 'var(--red)' }}
          >
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
            読み込み中...
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {weeks.map((week, wIdx) => {
              /* 週ラベル: 月内に存在する最初/最後の日付を採用、無ければ週端を採用 */
              const inMonth = week.filter((d) => d.inMonth);
              const startObj = new Date((inMonth[0] ?? week[0]).date);
              const endObj = new Date((inMonth[inMonth.length - 1] ?? week[6]).date);
              const label =
                `第${wIdx + 1}週 ` +
                `${startObj.getMonth() + 1}/${startObj.getDate()}（${DOW_LABELS[startObj.getDay()]}）` +
                ` 〜 ${endObj.getMonth() + 1}/${endObj.getDate()}（${DOW_LABELS[endObj.getDay()]}）`;
              return (
                <section
                  key={wIdx}
                  className="week-page bg-white rounded-lg p-4"
                  style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <h2 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
                      {year}年{month}月 {label}
                    </h2>
                    <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                      deaf-ic 送迎表
                    </span>
                  </div>
                  {/* Phase 52 (rev): 7 日固定で「1 見出し + 12 行 = 13 行」× 7 日 = 91 行を
                     A3 縦 1 枚に収める前提で描画する。print CSS で圧縮。 */}
                  {week.map(({ date, inMonth: isInMonth }) => {
                    const realRows = isInMonth ? buildDayRows(date) : [];
                    const padded: (ReturnType<typeof buildDayRows>[number] | null)[] = Array(SLOTS_PER_DAY)
                      .fill(null)
                      .map((_, i) => realRows[i] ?? null);
                    const dt = new Date(date);
                    const dayLabel = `${dt.getMonth() + 1}/${dt.getDate()}（${DOW_LABELS[dt.getDay()]}）`;
                    const dayLabelColor = !isInMonth
                      ? 'var(--ink-3)'
                      : dt.getDay() === 0
                        ? 'var(--red)'
                        : dt.getDay() === 6
                          ? 'var(--accent)'
                          : '#fff';

                    /* 場所ラベルの先頭絵文字（マーク）を抽出: "🐻 学校" → "🐻" */
                    const extractEmoji = (label: string | null | undefined): string => {
                      if (!label) return '';
                      const trimmed = label.trim();
                      const sp = trimmed.indexOf(' ');
                      return sp === -1 ? trimmed : trimmed.slice(0, sp);
                    };
                    return (
                      <div
                        key={date}
                        className="day-block mb-2"
                        style={{ opacity: isInMonth ? 1 : 0.45, position: 'relative' }}
                      >
                        <table className="w-full border-collapse" style={{ fontSize: '0.74rem' }}>
                          {/* Phase 47: 場所列を 110px 固定で狭く、担当列を 130px に広げる */}
                          <colgroup>
                            <col style={{ width: '70px' }} />
                            <col style={{ width: '24px' }} />
                            <col style={{ width: '95px' }} />
                            <col style={{ width: '110px' }} />
                            <col style={{ width: '110px' }} />
                            <col style={{ width: '100px' }} />
                            <col style={{ width: '130px' }} />
                            <col style={{ width: '130px' }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th
                                className="text-left whitespace-nowrap"
                                style={{
                                  background: 'var(--ink)',
                                  color: dayLabelColor,
                                  padding: '2px 6px',
                                }}
                              >
                                {dayLabel}
                                {!isInMonth && (
                                  <span style={{ marginLeft: 4, fontSize: '0.65rem' }}>(対象外)</span>
                                )}
                              </th>
                              <th
                                style={{
                                  background: 'var(--ink)',
                                  color: '#fff',
                                  padding: '2px 4px',
                                  textAlign: 'center',
                                }}
                              >
                                #
                              </th>
                              <th
                                className="text-left whitespace-nowrap"
                                style={{ background: 'var(--ink)', color: '#fff', padding: '2px 4px' }}
                              >
                                利用者名
                              </th>
                              <th
                                className="text-left whitespace-nowrap"
                                style={{ background: 'var(--ink)', color: '#fff', padding: '2px 4px' }}
                              >
                                迎場所
                              </th>
                              <th
                                className="text-left whitespace-nowrap"
                                style={{ background: 'var(--ink)', color: '#fff', padding: '2px 4px' }}
                              >
                                送場所
                              </th>
                              <th
                                className="text-left whitespace-nowrap"
                                style={{ background: 'var(--ink)', color: '#fff', padding: '2px 4px' }}
                              >
                                時間
                              </th>
                              <th
                                className="text-left whitespace-nowrap"
                                style={{ background: 'var(--ink)', color: '#fff', padding: '2px 4px' }}
                              >
                                迎担当
                              </th>
                              <th
                                className="text-left whitespace-nowrap"
                                style={{ background: 'var(--ink)', color: '#fff', padding: '2px 4px' }}
                              >
                                送担当
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {padded.map((r, i) => {
                              const cellStyle: React.CSSProperties = {
                                padding: '2px 4px',
                                border: '1px solid var(--rule)',
                                fontSize: '0.7rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              };
                              return (
                                <tr key={i}>
                                  <td style={{ ...cellStyle, background: 'var(--bg)' }}>&nbsp;</td>
                                  <td style={{ ...cellStyle, textAlign: 'center', color: 'var(--ink-3)' }}>
                                    {i + 1}
                                  </td>
                                  <td style={{ ...cellStyle, fontWeight: r ? 600 : 400 }}>
                                    {r?.childName ?? ''}
                                  </td>
                                  <td style={cellStyle}>
                                    {r ? (
                                      r.pickupMethod === 'self' ? (
                                        '保護者'
                                      ) : (
                                        <>
                                          <span style={{ color: 'var(--accent)' }}>迎</span> {r.pickupLabel || '-'}
                                        </>
                                      )
                                    ) : (
                                      ''
                                    )}
                                  </td>
                                  <td style={cellStyle}>
                                    {r ? (
                                      r.dropoffMethod === 'self' ? (
                                        '保護者'
                                      ) : (
                                        <>
                                          <span style={{ color: 'var(--green)' }}>送</span> {r.dropoffLabel || '-'}
                                        </>
                                      )
                                    ) : (
                                      ''
                                    )}
                                  </td>
                                  <td style={cellStyle}>
                                    {r ? (
                                      <>
                                        <span style={{ color: 'var(--accent)' }}>迎</span>{' '}
                                        {r.pickupTime || '-'}{' '}
                                        <span style={{ color: 'var(--green)' }}>送</span>{' '}
                                        {r.dropoffTime || '-'}
                                      </>
                                    ) : (
                                      ''
                                    )}
                                  </td>
                                  <td style={cellStyle}>
                                    {r
                                      ? r.pickupMethod === 'self'
                                        ? '保護者'
                                        : (() => {
                                            const mark = extractEmoji(r.pickupLabel);
                                            const names = r.pickupStaffNames || '-';
                                            return mark ? `${mark} ${names}` : names;
                                          })()
                                      : ''}
                                  </td>
                                  <td style={cellStyle}>
                                    {r
                                      ? r.dropoffMethod === 'self'
                                        ? '保護者'
                                        : (() => {
                                            const mark = extractEmoji(r.dropoffLabel);
                                            const names = r.dropoffStaffNames || '-';
                                            return mark ? `${mark} ${names}` : names;
                                          })()
                                      : ''}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
