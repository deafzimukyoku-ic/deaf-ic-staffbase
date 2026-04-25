'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, getDaysInMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import MonthStepper from '@/components/shift/MonthStepper';
import { MonthStatusBadge } from '@/components/shift/MonthStatusBadge';
import ShiftGridFull from '@/components/shift/ShiftGridFull';
import ApprovalQueueFull from '@/components/shift/ApprovalQueueFull';
import Button from '@/components/shift-compat/Button';
import Badge from '@/components/shift-compat/Badge';
import Modal from '@/components/shift-compat/Modal';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import { staffDisplayName } from '@/lib/shift-utils';
import { generateShiftAssignments, type ShiftWarning } from '@/lib/logic/generateShift';
import type {
  ShiftAssignmentType,
  ShiftAssignmentRow,
  ShiftRequestRow,
  ScheduleEntryRow,
  StaffRow,
  PublishStatus,
} from '@/lib/types';

/**
 * シフト表ページ本体（admin / manager 共通）
 *
 * 移植元: diletto-shift-maker/src/app/(app)/shift/page.tsx (618行)
 * 機械的変換:
 *  - staff_id → employee_id（DB側）。propsでは互換のため staff_id 名のまま
 *  - is_confirmed → publish_status('draft'|'ready'|'published')
 *  - useCurrentStaff() → role を props から受け取り
 *  - <Header> 削除（パンくず + サイドバーで識別、h1 表示しない）
 *  - 自前 API fetch → 直接 supabase クライアント（RLSで認可）
 *  - 月確定/解除ボタン → 公開フロー3段階ボタン群（draft → ready → published）
 *  - 公開時は /api/shifts/transition 経由で通知メールも enqueue される
 */

interface ShiftCell {
  staff_id: string; // = employee.id
  date: string;
  start_time: string | null;
  end_time: string | null;
  assignment_type: ShiftAssignmentType;
  segment_order?: number;
  note?: string | null;
  publish_status?: PublishStatus;
}

function defaultCurrentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface ShiftFullProps {
  role: 'admin' | 'manager';
}

export default function ShiftFull({ role }: ShiftFullProps) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get('month');
  const { year, month } = useMemo(() => {
    const source = urlMonth && /^\d{4}-\d{2}$/.test(urlMonth) ? urlMonth : defaultCurrentMonthStr();
    const [y, m] = source.split('-').map(Number);
    return { year: y, month: m };
  }, [urlMonth]);

  const [facilityId] = useShiftFacilityId();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [scheduleEntries, setScheduleEntries] = useState<ScheduleEntryRow[]>([]);
  const [shiftRequests, setShiftRequests] = useState<ShiftRequestRow[]>([]);
  const [cells, setCells] = useState<ShiftCell[]>([]);
  const [warnings, setWarnings] = useState<ShiftWarning[]>([]);

  // 月全体の publish_status を集約。「全行 published」なら published、「全行 ready」なら ready、
  // 「全行 draft」なら draft、混在なら mixed。
  const [monthStatus, setMonthStatus] = useState<PublishStatus | 'mixed' | 'empty'>('empty');

  const [editingCell, setEditingCell] = useState<{ staffId: string; date: string } | null>(null);
  const [editType, setEditType] = useState<ShiftAssignmentType>('normal');
  const [startH, setStartH] = useState('09');
  const [startM, setStartM] = useState('00');
  const [endH, setEndH] = useState('17');
  const [endM, setEndM] = useState('00');
  const [editNote, setEditNote] = useState('');

  // 公開確認モーダル
  const [publishModalOpen, setPublishModalOpen] = useState(false);

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const tenantId = staff[0]?.tenant_id ?? '';

  const childrenCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of scheduleEntries) {
      m.set(e.date, (m.get(e.date) ?? 0) + 1);
    }
    return m;
  }, [scheduleEntries]);

  const fetchAll = useCallback(async () => {
    if (!facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const from = `${monthStr}-01`;
      const lastDay = getDaysInMonth(new Date(year, month - 1));
      const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

      // employees (active)
      const { data: emps, error: eErr } = await supabase
        .from('employees')
        .select(
          'id, tenant_id, facility_id, last_name, first_name, email, role, employment_type, default_start_time, default_end_time, pickup_transport_areas, dropoff_transport_areas, qualifications, is_qualified, is_driver, is_attendant, shift_display_order, status'
        )
        .eq('facility_id', facilityId)
        .eq('status', 'active')
        .order('shift_display_order', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true });
      if (eErr) throw new Error('職員取得失敗: ' + eErr.message);

      const staffRows: StaffRow[] = (emps ?? []).map((e) => ({
        id: e.id,
        tenant_id: e.tenant_id,
        facility_id: e.facility_id,
        name: staffDisplayName({
          last_name: e.last_name,
          first_name: e.first_name,
        }),
        email: e.email ?? null,
        role: (e.role ?? 'employee') as 'admin' | 'manager' | 'employee',
        employment_type: (e.employment_type ?? 'full_time') as 'full_time' | 'part_time',
        default_start_time: e.default_start_time ?? null,
        default_end_time: e.default_end_time ?? null,
        pickup_transport_areas: e.pickup_transport_areas ?? [],
        dropoff_transport_areas: e.dropoff_transport_areas ?? [],
        qualifications: e.qualifications ?? [],
        is_qualified: !!e.is_qualified,
        is_driver: !!e.is_driver,
        is_attendant: !!e.is_attendant,
        shift_display_order: e.shift_display_order ?? null,
      }));

      // schedule_entries
      const { data: entries } = await supabase
        .from('schedule_entries')
        .select('*')
        .eq('facility_id', facilityId)
        .gte('date', from)
        .lte('date', to);

      // shift_requests
      const { data: reqs } = await supabase
        .from('shift_requests')
        .select('*')
        .eq('facility_id', facilityId)
        .eq('month', monthStr);

      // shift_assignments
      const { data: assigns } = await supabase
        .from('shift_assignments')
        .select('*')
        .eq('facility_id', facilityId)
        .gte('date', from)
        .lte('date', to);

      setStaff(staffRows);
      setScheduleEntries((entries ?? []) as ScheduleEntryRow[]);
      setShiftRequests((reqs ?? []) as ShiftRequestRow[]);

      const assignsArr = (assigns ?? []) as ShiftAssignmentRow[];
      setCells(
        assignsArr.map<ShiftCell>((a) => ({
          staff_id: a.employee_id,
          date: a.date,
          start_time: a.start_time,
          end_time: a.end_time,
          assignment_type: a.assignment_type,
          segment_order: a.segment_order ?? 0,
          note: a.note ?? null,
          publish_status: a.publish_status,
        }))
      );

      // 月の集約ステータス
      if (assignsArr.length === 0) {
        setMonthStatus('empty');
      } else {
        const statuses = new Set(assignsArr.map((a) => a.publish_status));
        if (statuses.size === 1) {
          setMonthStatus([...statuses][0] as PublishStatus);
        } else {
          setMonthStatus('mixed');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, facilityId, year, month, monthStr]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleGenerate = async () => {
    if (!facilityId || !tenantId) {
      alert('施設または職員情報が読み込まれていません');
      return;
    }
    if (monthStatus === 'published') {
      alert('公開済みのシフトは再生成できません。先に「公開取消」してから再生成してください。');
      return;
    }
    if (cells.length > 0) {
      if (!confirm(`${year}年${month}月のシフトを再生成しますか？（既存のセルは上書きされます）`)) return;
    }

    // 最新の希望/予定を再取得
    const from = `${monthStr}-01`;
    const lastDay = getDaysInMonth(new Date(year, month - 1));
    const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

    const [{ data: freshReqs }, { data: freshEntries }] = await Promise.all([
      supabase.from('shift_requests').select('*').eq('facility_id', facilityId).eq('month', monthStr),
      supabase
        .from('schedule_entries')
        .select('*')
        .eq('facility_id', facilityId)
        .gte('date', from)
        .lte('date', to),
    ]);

    const result = generateShiftAssignments({
      tenantId,
      facilityId,
      year,
      month,
      staff,
      shiftRequests: (freshReqs ?? []) as ShiftRequestRow[],
      scheduleEntries: (freshEntries ?? []) as ScheduleEntryRow[],
    });

    // upsert（unique: tenant_id, facility_id, employee_id, date, segment_order）
    const { error: upErr } = await supabase.from('shift_assignments').upsert(
      result.assignments.map((a) => ({
        tenant_id: a.tenant_id,
        facility_id: a.facility_id,
        employee_id: a.employee_id,
        date: a.date,
        start_time: a.start_time,
        end_time: a.end_time,
        assignment_type: a.assignment_type,
        is_confirmed: false,
        publish_status: 'draft' as PublishStatus,
        segment_order: a.segment_order ?? 0,
        note: a.note ?? null,
      })),
      { onConflict: 'tenant_id,facility_id,employee_id,date,segment_order' }
    );
    if (upErr) {
      alert('保存失敗: ' + upErr.message);
      return;
    }
    setWarnings(result.warnings);
    await fetchAll();
  };

  const handleCellClick = (staffId: string, date: string) => {
    if (monthStatus === 'published') {
      // 公開済みは編集不可（変更したい場合は先に「公開取消」）
      alert('公開済みシフトは編集できません。「公開取消」で ready に戻してから編集してください。');
      return;
    }
    const cell = cells.find((c) => c.staff_id === staffId && c.date === date);
    const s = staff.find((x) => x.id === staffId);
    if (cell) {
      setEditType(cell.assignment_type);
      if (cell.start_time) {
        const [h, m] = cell.start_time.split(':');
        setStartH(h);
        setStartM(m);
      } else {
        setStartH(s?.default_start_time?.split(':')[0] ?? '09');
        setStartM(s?.default_start_time?.split(':')[1] ?? '00');
      }
      if (cell.end_time) {
        const [h, m] = cell.end_time.split(':');
        setEndH(h);
        setEndM(m);
      } else {
        setEndH(s?.default_end_time?.split(':')[0] ?? '17');
        setEndM(s?.default_end_time?.split(':')[1] ?? '00');
      }
    } else {
      setEditType('normal');
    }
    setEditNote(cell?.note ?? '');
    setEditingCell({ staffId, date });
  };

  const handleSave = async () => {
    if (!editingCell || !facilityId || !tenantId) return;
    // 現状の publish_status を維持（draft/ready で編集可、published は handleCellClick で弾く）
    const currentPublish: PublishStatus = monthStatus === 'ready' ? 'ready' : 'draft';

    const { error: upErr } = await supabase.from('shift_assignments').upsert(
      [
        {
          tenant_id: tenantId,
          facility_id: facilityId,
          employee_id: editingCell.staffId,
          date: editingCell.date,
          assignment_type: editType,
          start_time: editType === 'normal' ? `${startH}:${startM}` : null,
          end_time: editType === 'normal' ? `${endH}:${endM}` : null,
          is_confirmed: monthStatus === 'ready' || monthStatus === 'published',
          publish_status: currentPublish,
          segment_order: 0,
          note:
            (editType === 'normal' || editType === 'public_holiday' || editType === 'off') &&
            editNote.trim()
              ? editNote.trim()
              : null,
        },
      ],
      { onConflict: 'tenant_id,facility_id,employee_id,date,segment_order' }
    );

    if (upErr) {
      alert('保存失敗: ' + upErr.message);
      return;
    }
    setEditingCell(null);
    await fetchAll();
  };

  // === 公開フロー遷移 ===
  const transitionTo = async (target: 'ready' | 'published' | 'draft' | 'ready_back') => {
    if (!facilityId) return;
    try {
      const res = await fetch('/api/shifts/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_id: facilityId, year, month, target }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '遷移失敗');
      await fetchAll();
      return json;
    } catch (e) {
      alert(e instanceof Error ? e.message : '遷移失敗');
    }
  };

  const editingStaff = editingCell ? staff.find((s) => s.id === editingCell.staffId) : null;
  const editingCellData = editingCell
    ? cells.find((c) => c.staff_id === editingCell.staffId && c.date === editingCell.date)
    : null;

  const summary = useMemo(() => {
    if (cells.length === 0) return null;
    const understaffedDays = warnings.filter((w) => w.type === 'understaffed').length;
    const noQualifiedDays = warnings.filter((w) => w.type === 'no_qualified').length;
    return { understaffedDays, noQualifiedDays, totalWarnings: warnings.length };
  }, [cells, warnings]);

  if (!facilityId) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">事業所を上部から選択してください。</p>
      </div>
    );
  }

  return (
    // 親レイアウト (admin/manager) の p-6 lg:p-8 を打ち消して縦横をフルに使う
    // シフト表は情報密度が高いので余白を最小限に
    <div className="flex flex-col h-full overflow-hidden shift-print-root -m-6 lg:-m-8">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A3 landscape; margin: 6mm; }
              .shift-print-root { overflow: visible !important; height: auto !important; }
              .shift-print-root .flex-1 { overflow: visible !important; padding: 0 !important; }
              .shift-print-root table {
                font-size: 8pt !important;
                width: 100% !important;
                min-width: 0 !important;
                table-layout: fixed !important;
              }
              .shift-print-root th,
              .shift-print-root td {
                min-width: 0 !important;
                padding: 6px 2px !important;
                font-size: 8pt !important;
                line-height: 1.25 !important;
                overflow: hidden;
              }
              .shift-print-root thead th:first-child,
              .shift-print-root tbody td:first-child {
                width: 110px !important;
                min-width: 110px !important;
                padding: 6px 4px !important;
              }
              .shift-print-root .sticky,
              .shift-print-root [class*="sticky"] {
                position: static !important;
                left: auto !important;
                top: auto !important;
                box-shadow: none !important;
              }
              .shift-print-root .group { cursor: default !important; }
              .shift-print-root tr:hover { background: inherit !important; }
              .shift-print-title { display: block !important; font-size: 13pt; font-weight: 700; margin-bottom: 4mm; }
            }
            @media screen { .shift-print-title { display: none; } }
          `,
        }}
      />
      <h1 className="shift-print-title print-only">{year}年{month}月 シフト表</h1>

      {/* ヘッダー（h1 非表示・パンくずで識別。アクションだけ右寄せ）
          シフト表は縦も横も詰めて使うので上下 padding は最小に */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-1 pb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <MonthStepper defaultMonth={defaultCurrentMonthStr()} />
          {/* 月の集約ステータス バッジ */}
          {monthStatus === 'published' && <Badge variant="success">公開中</Badge>}
          {monthStatus === 'ready' && <Badge variant="warning">仮シフト（職員確認中）</Badge>}
          {monthStatus === 'draft' && <Badge variant="neutral">下書き</Badge>}
          {monthStatus === 'mixed' && <Badge variant="warning">部分公開（混在）</Badge>}
          {monthStatus !== 'empty' && (
            <MonthStatusBadge
              status={
                monthStatus === 'published'
                  ? 'complete'
                  : monthStatus === 'ready' || monthStatus === 'draft'
                  ? 'incomplete'
                  : 'incomplete'
              }
            />
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {cells.length > 0 && (
            <Button variant="secondary" onClick={() => window.print()} title="A3 横で印刷">
              🖨 印刷
            </Button>
          )}

          {cells.length === 0 ? (
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={staff.length === 0 || scheduleEntries.length === 0}
            >
              シフト生成
            </Button>
          ) : (
            <>
              {/* draft / mixed 状態: 再生成 + 仮シフト確定 */}
              {(monthStatus === 'draft' || monthStatus === 'mixed') && (
                <>
                  <Button variant="secondary" onClick={handleGenerate}>
                    再生成
                  </Button>
                  <Button variant="primary" onClick={() => transitionTo('ready')}>
                    仮シフト確定 → 職員確認
                  </Button>
                </>
              )}

              {/* ready 状態: 公開 + 下書きに戻す + 再生成 */}
              {monthStatus === 'ready' && (
                <>
                  <Button variant="secondary" onClick={() => transitionTo('draft')}>
                    下書きに戻す
                  </Button>
                  <Button variant="primary" onClick={() => setPublishModalOpen(true)}>
                    公開する
                  </Button>
                </>
              )}

              {/* published 状態: 公開取消（→ready） */}
              {monthStatus === 'published' && (
                <Button variant="secondary" onClick={() => transitionTo('ready_back')}>
                  公開取消（編集に戻す）
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 pt-0">
        {/* admin のみ承認キュー表示 */}
        {role === 'admin' && (
          <ApprovalQueueFull
            staff={staff.map((s) => ({ id: s.id, name: s.name }))}
            canApprove={true}
            facilityId={facilityId}
          />
        )}

        {error && (
          <div
            className="mb-2 px-4 py-2 rounded"
            style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}
          >
            {error}
          </div>
        )}

        {summary && summary.totalWarnings > 0 && (
          <div
            className="flex gap-3 mb-4 px-4 py-3 flex-wrap"
            style={{
              background: 'var(--red-pale)',
              borderRadius: '8px',
              border: '1px solid rgba(155,51,51,0.15)',
            }}
          >
            {summary.understaffedDays > 0 && (
              <Badge variant="error">人員不足 {summary.understaffedDays}日</Badge>
            )}
            {summary.noQualifiedDays > 0 && (
              <Badge variant="warning">有資格者不足 {summary.noQualifiedDays}日</Badge>
            )}
            <span className="text-xs" style={{ color: 'var(--red)' }}>
              セルをクリックして調整してください
            </span>
          </div>
        )}

        {loading ? (
          <div
            className="h-96 flex items-center justify-center text-sm"
            style={{ color: 'var(--ink-3)' }}
          >
            読み込み中...
          </div>
        ) : (
          /* シフト未生成時は骨格 (職員行+日付ヘッダー) をうっすら描画 + 中央オーバーレイカード。
             生成済 (cells.length > 0) と未生成で UI 差別化を強くするため pointer-events: none で完全に編集不可に。 */
          <div className="relative flex flex-col h-full min-h-[500px]">
            <div
              style={{
                opacity: cells.length === 0 ? 0.28 : 1,
                pointerEvents: cells.length === 0 ? 'none' : 'auto',
                filter: cells.length === 0 ? 'saturate(0.4)' : 'none',
                transition: 'opacity 0.2s, filter 0.2s',
              }}
              aria-hidden={cells.length === 0}
            >
              <ShiftGridFull
                year={year}
                month={month}
                staff={staff.map((s) => ({
                  id: s.id,
                  name: s.name,
                  employment_type: s.employment_type,
                  is_qualified: s.is_qualified,
                }))}
                cells={cells}
                warnings={warnings}
                onCellClick={handleCellClick}
                childrenCountByDate={childrenCountByDate}
              />
            </div>

            {cells.length === 0 && (
              <div
                className="absolute inset-0 flex items-start justify-center pt-16 print-hide"
                style={{ background: 'rgba(255,255,255,0.55)' }}
              >
                <div
                  className="rounded-lg px-8 py-7 max-w-md w-[90%] text-center"
                  style={{
                    background: 'var(--white)',
                    border: '1px solid var(--rule)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                  }}
                >
                  <div className="text-3xl mb-2">📋</div>
                  <p className="text-lg font-bold mb-2" style={{ color: 'var(--ink)' }}>
                    シフトが未生成です
                  </p>
                  <p className="text-sm mb-5" style={{ color: 'var(--ink-2)' }}>
                    利用予定と休み希望を元に自動でシフトを作成します。
                  </p>

                  <div
                    className="text-left text-xs mb-5 px-4 py-3 rounded"
                    style={{ background: 'var(--bg)', color: 'var(--ink-2)', lineHeight: 1.8 }}
                  >
                    <div>
                      <span style={{ color: staff.length > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {staff.length > 0 ? '✓' : '×'}
                      </span>{' '}
                      登録職員: <b>{staff.length}名</b>
                    </div>
                    <div>
                      <span style={{ color: scheduleEntries.length > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {scheduleEntries.length > 0 ? '✓' : '×'}
                      </span>{' '}
                      利用予定: <b>{scheduleEntries.length}件</b>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-3)' }}>○</span> 休み希望:{' '}
                      <b>{shiftRequests.length}件</b>{' '}
                      <span style={{ color: 'var(--ink-3)' }}>（任意）</span>
                    </div>
                  </div>

                  <Button
                    variant="primary"
                    onClick={handleGenerate}
                    disabled={staff.length === 0 || scheduleEntries.length === 0}
                  >
                    シフト生成
                  </Button>

                  <ul
                    className="text-[11px] mt-5 text-left space-y-1"
                    style={{ color: 'var(--ink-3)', lineHeight: 1.6 }}
                  >
                    <li>※ 休み希望は未提出でも生成できます。</li>
                    <li>※ 後から再生成すれば最新の休み希望が反映されます。</li>
                    <li>※ 生成後もセルをクリックして個別調整できます。</li>
                    {(staff.length === 0 || scheduleEntries.length === 0) && (
                      <li style={{ color: 'var(--red)', fontWeight: 600, marginTop: 6 }}>
                        ⚠ 職員と利用予定が両方登録されている必要があります。
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* セル編集モーダル */}
      <Modal
        isOpen={!!editingCell}
        onClose={() => setEditingCell(null)}
        title={
          editingCell && editingStaff
            ? `${editingStaff.name} — ${format(new Date(editingCell.date), 'M/d（E）', { locale: ja })}`
            : ''
        }
      >
        {editingCell && editingStaff && (
          <div className="flex flex-col gap-4">
            <div
              className="px-3 py-2 flex items-center gap-2"
              style={{ background: 'var(--bg)', borderRadius: '6px' }}
            >
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                {editingStaff.name}
              </span>
              {editingStaff.is_qualified && <Badge variant="success">有資格</Badge>}
            </div>

            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
              現在:{' '}
              {editingCellData
                ? ({ normal: '出勤', public_holiday: '公休', paid_leave: '有給', off: '休み' } as Record<
                    string,
                    string
                  >)[editingCellData.assignment_type]
                : '-'}
            </p>

            <div className="grid grid-cols-2 gap-2">
              {(['normal', 'public_holiday', 'paid_leave', 'off'] as const).map((type) => {
                const labels: Record<ShiftAssignmentType, string> = {
                  normal: '出勤',
                  public_holiday: '公休',
                  paid_leave: '有給',
                  off: '休み',
                };
                const colors: Record<ShiftAssignmentType, string> = {
                  normal: 'var(--ink)',
                  public_holiday: 'var(--accent)',
                  paid_leave: 'var(--green)',
                  off: 'var(--ink-3)',
                };
                const isActive = editType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setEditType(type)}
                    className="px-4 py-3 text-sm font-semibold rounded-md transition-all"
                    style={{
                      background: isActive ? colors[type] : 'var(--bg)',
                      color: isActive ? '#fff' : colors[type],
                      border: `1.5px solid ${colors[type]}`,
                    }}
                  >
                    {labels[type]}
                  </button>
                );
              })}
            </div>

            {editType === 'normal' && (
              <div className="flex flex-col gap-4 mt-2 p-4 rounded-lg" style={{ background: 'var(--bg)' }}>
                <div>
                  <label className="text-xs font-bold mb-2 block" style={{ color: 'var(--ink-2)' }}>
                    勤務時間
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={startH}
                      onChange={(e) => setStartH(e.target.value.slice(0, 2))}
                      className="w-12 text-center font-bold text-lg bg-transparent border-b-2 border-[var(--accent)] outline-none"
                    />
                    <span className="font-bold">:</span>
                    <input
                      type="text"
                      value={startM}
                      onChange={(e) => setStartM(e.target.value.slice(0, 2))}
                      className="w-12 text-center font-bold text-lg bg-transparent border-b-2 border-[var(--accent)] outline-none"
                    />
                    <span className="mx-2 text-gray-400">〜</span>
                    <input
                      type="text"
                      value={endH}
                      onChange={(e) => setEndH(e.target.value.slice(0, 2))}
                      className="w-12 text-center font-bold text-lg bg-transparent border-b-2 border-[var(--accent)] outline-none"
                    />
                    <span className="font-bold">:</span>
                    <input
                      type="text"
                      value={endM}
                      onChange={(e) => setEndM(e.target.value.slice(0, 2))}
                      className="w-12 text-center font-bold text-lg bg-transparent border-b-2 border-[var(--accent)] outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {(editType === 'normal' || editType === 'public_holiday' || editType === 'off') && (
              <div>
                <label className="text-xs font-bold mb-2 block" style={{ color: 'var(--ink-2)' }}>
                  メモ（任意・例: 応援先など）
                </label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value.slice(0, 40))}
                  rows={2}
                  placeholder="例: パステル"
                  className="w-full text-sm rounded-md px-3 py-2 outline-none"
                  style={{ background: 'var(--bg)', border: '1px solid var(--rule)', color: 'var(--ink)' }}
                />
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <Button variant="secondary" className="flex-1" onClick={() => setEditingCell(null)}>
                キャンセル
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleSave}>
                保存する
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 公開確認モーダル */}
      <Modal
        isOpen={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        title="シフトを公開しますか？"
      >
        <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--ink-2)' }}>
          <p>
            <strong>{year}年{month}月</strong> のシフトを公開します。
          </p>
          <ul className="list-disc pl-5 text-xs" style={{ color: 'var(--ink-3)' }}>
            <li>送迎表も同時に公開状態になります。</li>
            <li>NPO 全 admin に公開通知メールが送信されます（最大10分以内）。</li>
            <li>公開後の編集には「公開取消」が必要です。</li>
          </ul>
          <div className="flex gap-2 mt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setPublishModalOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={async () => {
                setPublishModalOpen(false);
                await transitionTo('published');
              }}
            >
              公開する
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
