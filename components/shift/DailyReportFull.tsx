'use client';

/**
 * 業務日報出力（A4 縦・複数日連続印刷）
 *
 * 入力:
 *   - 施設（layout の useShiftFacilityId 経由で選択中の事業所）
 *   - 日付範囲（date_from / date_to）
 *
 * 出力レイアウト（1 日 1 ページ A4 縦）:
 *   - ヘッダー: 「{施設名} 業務日報」 + YYYY年MM月DD日(曜)
 *   - 利用者表（2 列）: 利用者氏名 / 出欠席 / 備考
 *     児童発達支援（preschool/nursery）と 放課後等デイサービス（elementary+）に分類して合計を表示
 *   - 出勤職員表（2 列）: 氏名 / 出勤時刻
 *   - 活動内容/連絡事項枠: facility.daily_report_template を whitespace-pre-line で印字
 *
 * 印刷:
 *   - window.print() を発火
 *   - @page { size: A4 portrait; }
 *   - 各ページの末尾に page-break-after: always
 *   - 1日表/2日裏 のような両面印刷はブラウザ印刷ダイアログで両面 ON にすれば自動で並ぶ
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import Button from '@/components/shift-compat/Button';
import { staffDisplayName } from '@/lib/shift-utils';
import { fetchFacilityMembers } from '@/lib/multi-facility';
import type { GradeType } from '@/lib/constants';
import { GRADE_GROUPS } from '@/lib/constants';
import type {
  StaffRow,
  ChildRow,
  ScheduleEntryRow,
  ShiftAssignmentRow,
  Facility,
} from '@/lib/types';

interface Props {
  role: 'admin' | 'manager';
}

/** YYYY-MM-DD 文字列を返す */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → "M月D日(曜)" */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function formatJapaneseDate(date: string): { y: string; md: string } {
  const d = new Date(date + 'T00:00:00');
  const y = `${d.getFullYear()}年`;
  const md = `${d.getMonth() + 1}月 ${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
  return { y, md };
}

/** 学年から区分判定: 児童発達支援 / 放課後等デイサービス */
function classifyService(grade: GradeType): '児童発達' | '放課後' {
  if ((GRADE_GROUPS.preschool.grades as readonly GradeType[]).includes(grade)) return '児童発達';
  return '放課後';
}

/** 出欠ステータス→セル文字。Phase 64: waitlist は「待」、leave は空欄。 */
function attendanceLabel(status: string | null | undefined): string {
  switch (status) {
    case 'present': return '✓';
    case 'absent': return '✗';
    case 'late': return '遅';
    case 'early_leave': return '早';
    case 'waitlist': return '待';
    default: return '';
  }
}

/** "08:30:00" → "08:30" */
function trimSeconds(t: string | null | undefined): string {
  if (!t) return '';
  return t.length >= 5 ? t.slice(0, 5) : t;
}

/** 期間 [from, to] の YYYY-MM-DD 配列を返す */
function listDates(from: string, to: string): string[] {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (a > b) return [];
  const out: string[] = [];
  const cur = new Date(a);
  while (cur <= b) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default function DailyReportFull({ role: _role }: Props) {
  const [facilityId] = useShiftFacilityId();
  const supabase = useMemo(() => createClient(), []);

  /* デフォルトは今月の1日〜末日 */
  const defaultRange = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: ymd(from), to: ymd(to) };
  }, []);

  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);

  const [facility, setFacility] = useState<Facility | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [entries, setEntries] = useState<ScheduleEntryRow[]>([]);
  const [shifts, setShifts] = useState<ShiftAssignmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      // 職員一覧は SECURITY DEFINER RPC（migration 155）で RLS バイパス。manager / shift_manager 対応
      const allMembers = await fetchFacilityMembers(supabase, facilityId);
      const empRows = allMembers
        .filter((m) => m.status === 'active')
        .sort((a, b) => {
          const ao = a.shift_display_order ?? Number.MAX_SAFE_INTEGER;
          const bo = b.shift_display_order ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return ao - bo;
          return (a.last_name ?? '').localeCompare(b.last_name ?? '', 'ja');
        });

      const [facRes, childRes, entryRes, shiftRes] = await Promise.all([
        supabase.from('facilities').select('*').eq('id', facilityId).single(),
        supabase.from('children').select('*').eq('facility_id', facilityId),
        supabase
          .from('schedule_entries')
          .select('*')
          .eq('facility_id', facilityId)
          .gte('date', dateFrom)
          .lte('date', dateTo),
        supabase
          .from('shift_assignments')
          .select('*')
          .eq('facility_id', facilityId)
          .gte('date', dateFrom)
          .lte('date', dateTo),
      ]);

      if (facRes.error) throw facRes.error;
      if (childRes.error) throw childRes.error;
      if (entryRes.error) throw entryRes.error;
      if (shiftRes.error) throw shiftRes.error;

      setFacility(facRes.data as Facility);

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
      setEntries((entryRes.data ?? []) as ScheduleEntryRow[]);
      setShifts((shiftRes.data ?? []) as ShiftAssignmentRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [facilityId, dateFrom, dateTo, supabase]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const dates = useMemo(() => listDates(dateFrom, dateTo), [dateFrom, dateTo]);
  const childById = useMemo(() => new Map(children.map((c) => [c.id, c])), [children]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  /* 施設名から絵文字 prefix を除去（業務日報には絵文字無しで印字） */
  const facilityDisplayName = useMemo(() => {
    if (!facility) return '';
    return (facility.name || '').replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, '').trim();
  }, [facility]);

  if (!facilityId) {
    return (
      <div className="p-8 text-center text-sm text-diletto-gray">
        施設を選択してください
      </div>
    );
  }

  return (
    <>
      {/* 操作バー（印刷時は非表示） */}
      <div className="no-print sticky top-0 z-30 bg-white border-b border-diletto-gray/10 p-4 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold mr-auto">📋 業務日報</h1>
        <label className="text-xs text-diletto-gray flex items-center gap-1">
          開始
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-diletto-gray/20 bg-white px-2 text-sm"
          />
        </label>
        <label className="text-xs text-diletto-gray flex items-center gap-1">
          終了
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-diletto-gray/20 bg-white px-2 text-sm"
          />
        </label>
        <Button onClick={() => window.print()}>🖨️ 印刷 / PDF</Button>
      </div>

      {loading && <p className="p-8 text-center text-sm text-diletto-gray-light">読み込み中...</p>}
      {error && <p className="p-8 text-center text-sm text-diletto-red">エラー: {error}</p>}

      {!loading && !error && dates.length === 0 && (
        <p className="p-8 text-center text-sm text-diletto-gray-light">期間が不正です。</p>
      )}

      {/* 印刷本体 */}
      <div className="report-root">
        {dates.map((d) => {
          const dayEntries = entries.filter((e) => e.date === d);
          const dayShifts = shifts.filter((s) => s.date === d);

          /* 児童を 児童発達 / 放課後 で分割。出欠は absent も「✗」で表示するので除外しない。 */
          const enriched = dayEntries.map((e) => {
            const c = childById.get(e.child_id);
            return c ? { entry: e, child: c, kind: classifyService(c.grade_type) } : null;
          }).filter((x): x is NonNullable<typeof x> => x !== null);

          const preschool = enriched.filter((x) => x.kind === '児童発達').sort((a, b) => a.child.name.localeCompare(b.child.name, 'ja'));
          const afterSchool = enriched.filter((x) => x.kind === '放課後').sort((a, b) => a.child.name.localeCompare(b.child.name, 'ja'));

          /* 出勤職員: assignment_type='normal' のみ、segment_order でソート、同じ employee は時間連結 */
          const empToShifts = new Map<string, ShiftAssignmentRow[]>();
          for (const sa of dayShifts) {
            if (sa.assignment_type !== 'normal') continue;
            if (!empToShifts.has(sa.employee_id)) empToShifts.set(sa.employee_id, []);
            empToShifts.get(sa.employee_id)!.push(sa);
          }
          const staffRows = Array.from(empToShifts.entries())
            .map(([empId, sas]) => {
              const s = staffById.get(empId);
              if (!s) return null;
              const sorted = sas.slice().sort((a, b) => (a.segment_order ?? 0) - (b.segment_order ?? 0));
              const timeStr = sorted
                .map((sa) => `${trimSeconds(sa.start_time)}〜${trimSeconds(sa.end_time)}`)
                .join(' / ');
              return { staff: s, time: timeStr, displayOrder: s.shift_display_order ?? 9999 };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .sort((a, b) => a.displayOrder - b.displayOrder);

          const { y, md } = formatJapaneseDate(d);

          return (
            <section key={d} className="report-page">
              <header className="report-title">
                <span className="title-text">{facilityDisplayName}業務日報</span>
                <div className="title-date">
                  <span>{y}</span>
                  <span className="ml-4">{md}</span>
                </div>
              </header>

              <ChildrenTable preschool={preschool} afterSchool={afterSchool} />

              <StaffTable rows={staffRows} />

              <ActivityBox template={facility?.daily_report_template ?? ''} />
            </section>
          );
        })}
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          /* 親レイアウト由来の sidebar / header を消す（既存の他出力と同じ手法） */
          aside, header[class*="sticky"], nav {
            display: none !important;
          }
        }

        .report-root {
          background: #f5f5f0;
          padding: 16px;
        }
        .report-page {
          background: white;
          color: #000;
          width: 194mm;       /* A4(210) - 余白 8mm × 2 */
          min-height: 281mm;  /* A4(297) - 余白 8mm × 2 */
          margin: 0 auto 16px;
          padding: 4mm;
          page-break-after: always;
          display: flex;
          flex-direction: column;
          font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
          border: 1px solid #ccc;
        }
        @media print {
          .report-root { background: white; padding: 0; }
          .report-page { border: none; margin: 0; box-shadow: none; }
          .report-page:last-child { page-break-after: auto; }
        }

        .report-title {
          text-align: center;
          margin-bottom: 4px;
        }
        .report-title .title-text {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 2px;
        }
        .report-title .title-date {
          font-size: 14px;
          margin-top: 4px;
          padding: 4px 0;
          border-top: 2px solid #000;
          border-bottom: 2px solid #000;
        }

        .report-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        .report-table th, .report-table td {
          border: 1px solid #000;
          padding: 2px 4px;
          line-height: 1.6;
          height: 22px;
          vertical-align: middle;
        }
        .report-table th {
          background: #f0f0f0;
          font-weight: 600;
          font-size: 11px;
          text-align: center;
        }
        .report-table td.center { text-align: center; }
        .report-table td.name { padding-left: 6px; }

        .activity-box {
          margin-top: 4px;
          flex: 1;
          border: 1px solid #000;
          padding: 8px;
          font-size: 12px;
          white-space: pre-line;
          line-height: 1.7;
          min-height: 60mm;
        }
        .activity-box-title {
          text-align: center;
          font-weight: 600;
          border-bottom: 1px solid #000;
          padding-bottom: 4px;
          margin: -8px -8px 8px;
          padding-top: 4px;
          background: #f0f0f0;
        }
      `}</style>
    </>
  );
}

/* ========== 利用者表 ========== */
function ChildrenTable({
  preschool,
  afterSchool,
}: {
  preschool: { entry: ScheduleEntryRow; child: ChildRow }[];
  afterSchool: { entry: ScheduleEntryRow; child: ChildRow }[];
}) {
  /* 1 ページ A4 で残スペースを考えると、左右 2 列 × 各 12 行 = 24 名/枠程度。
     行数固定（少ない側は空行で埋める）。
     列の振り分け:
       - preschool が居る場合: 左=児童発達支援(preschool) / 右=放課後等デイサービス
       - preschool が居ない施設: 放課後等デイサービスを左から流し込み、12 名超えたら右に続く
     合計行は preschool 件数 / afterSchool 件数 / 合計 を実数で表示。 */
  const ROWS = 12;
  type Cell = { entry: ScheduleEntryRow; child: ChildRow } | null;

  let left: Cell[];
  let right: Cell[];
  if (preschool.length > 0) {
    left = [...preschool, ...Array<Cell>(Math.max(0, ROWS - preschool.length)).fill(null)].slice(0, ROWS);
    right = [...afterSchool, ...Array<Cell>(Math.max(0, ROWS - afterSchool.length)).fill(null)].slice(0, ROWS);
  } else {
    /* preschool 0 件の施設は放課後だけを左右に流し込み */
    const all: Cell[] = afterSchool.slice(0, ROWS * 2);
    while (all.length < ROWS * 2) all.push(null);
    left = all.slice(0, ROWS);
    right = all.slice(ROWS, ROWS * 2);
  }

  function renderCells(row: Cell) {
    if (!row) return <><td className="name"></td><td className="center"></td><td></td></>;
    return (
      <>
        <td className="name">{row.child.name}</td>
        <td className="center">{attendanceLabel(row.entry.attendance_status)}</td>
        <td>{row.entry.note || ''}</td>
      </>
    );
  }

  return (
    <table className="report-table" style={{ marginTop: 6 }}>
      <thead>
        <tr>
          <th style={{ width: '30%' }}>利用者氏名</th>
          <th style={{ width: '10%' }}>出欠席</th>
          <th style={{ width: '10%' }}>備考</th>
          <th style={{ width: '30%' }}>利用者氏名</th>
          <th style={{ width: '10%' }}>出欠席</th>
          <th style={{ width: '10%' }}>備考</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: ROWS }).map((_, i) => (
          <tr key={i}>
            {renderCells(left[i] ?? null)}
            {renderCells(right[i] ?? null)}
          </tr>
        ))}
        {/* 人数は出さず「名」だけ右揃えで表示する（業務日報は手書き想定）*/}
        <tr>
          <td className="name" style={{ background: '#fafafa' }}>児童発達支援</td>
          <td className="center" colSpan={1} style={{ background: '#fafafa' }}>計</td>
          <td style={{ background: '#fafafa', textAlign: 'right', paddingRight: '0.5em' }}>名</td>
          <td className="name" style={{ background: '#fafafa' }}>放課後等デイサービス</td>
          <td className="center" style={{ background: '#fafafa' }}>計</td>
          <td style={{ background: '#fafafa', textAlign: 'right', paddingRight: '0.5em' }}>名</td>
        </tr>
        <tr>
          <td colSpan={3} style={{ background: '#fafafa' }}></td>
          <td className="name" style={{ background: '#fafafa' }}>合計</td>
          <td colSpan={2} style={{ background: '#fafafa', textAlign: 'right', paddingRight: '0.5em' }}>名</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ========== 出勤職員表 ========== */
function StaffTable({ rows }: { rows: { staff: StaffRow; time: string; displayOrder: number }[] }) {
  const ROWS = 9;
  const padded: ({ staff: StaffRow; time: string } | null)[] = [];
  for (let i = 0; i < ROWS * 2; i++) padded[i] = rows[i] || null;
  const left = padded.slice(0, ROWS);
  const right = padded.slice(ROWS, ROWS * 2);

  function renderCells(r: { staff: StaffRow; time: string } | null) {
    if (!r) return <><td className="name"></td><td className="center"></td></>;
    return (
      <>
        <td className="name">{staffDisplayName(r.staff)}</td>
        <td className="center">{r.time}</td>
      </>
    );
  }

  return (
    <table className="report-table" style={{ marginTop: 4 }}>
      <thead>
        <tr>
          <th colSpan={4} style={{ fontSize: 13, padding: '4px 0', letterSpacing: 4 }}>出 勤 職 員</th>
        </tr>
        <tr>
          <th style={{ width: '40%' }}>氏　　名</th>
          <th style={{ width: '10%' }}>出勤</th>
          <th style={{ width: '40%' }}>氏　　名</th>
          <th style={{ width: '10%' }}>出勤</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: ROWS }).map((_, i) => (
          <tr key={i}>
            {renderCells(left[i] ?? null)}
            {renderCells(right[i] ?? null)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ========== 活動内容/連絡事項枠 ========== */
function ActivityBox({ template }: { template: string }) {
  return (
    <div className="activity-box">
      <div className="activity-box-title">活動内容／連絡事項</div>
      {template || ' '}
    </div>
  );
}
