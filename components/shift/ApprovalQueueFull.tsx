'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import Badge from '@/components/shift-compat/Badge';
import Button from '@/components/shift-compat/Button';
import Modal from '@/components/shift-compat/Modal';
import { createClient } from '@/lib/supabase/client';
import type {
  ShiftAssignmentType,
  ShiftChangeRequestRow,
} from '@/lib/types';

/**
 * シフト変更申請の承認キュー（admin のみ承認可、manager は閲覧のみ）
 *
 * 移植元: diletto-shift-maker/src/components/shift/ApprovalQueue.tsx (245行)
 * 機械的変換:
 *  - staff_id → employee_id
 *  - viewer/editor/admin → employee/manager/admin（admin のみ承認）
 *  - 自前 fetch /api/shift-change-requests (GET) → 直接 supabase クライアント (RLS で絞る)
 *  - PATCH は /api/shifts/shift-change-requests/[id] にルーティング変更
 *  - canApprove: admin のみ true（出勤中admin制約は簡略化、admin 全員可）
 *  - 案Z: pending リストには ready / published シフトに対する申請も含まれる
 */

const ASSIGNMENT_LABELS: Record<ShiftAssignmentType, string> = {
  normal: '出勤',
  public_holiday: '公休',
  requested_off: '希望休',
  paid_leave: '有給',
  off: '休み',
};

const TYPE_LABELS = {
  time: '時刻変更',
  leave: '休暇申請',
  type_change: '種別変更',
} as const;

interface StaffNameLookup {
  id: string;
  name: string;
}

interface Props {
  staff: StaffNameLookup[];
  /** 現在のユーザが admin か（承認ボタン表示判定） */
  canApprove: boolean;
  /** facility_id 絞り込み（admin が他 facility の申請を見ない場合に使用。null = 全 facility） */
  facilityId?: string | null;
}

export default function ApprovalQueueFull({ staff, canApprove, facilityId }: Props) {
  const supabase = createClient();
  const [requests, setRequests] = useState<ShiftChangeRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ShiftChangeRequestRow | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('shift_change_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (facilityId) q = q.eq('facility_id', facilityId);
      const { data, error } = await q;
      if (error) throw error;
      setRequests((data ?? []) as ShiftChangeRequestRow[]);
    } catch (e) {
      console.error('[ApprovalQueue] fetch failed', e);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, facilityId]);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  const handleReview = async (action: 'approve' | 'reject') => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shifts/shift-change-requests/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, admin_note: adminNote || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '処理失敗');
      setSelected(null);
      setAdminNote('');
      await fetchPending();
    } catch (e) {
      alert(e instanceof Error ? e.message : '処理失敗');
    } finally {
      setBusy(false);
    }
  };

  const getStaffName = (id: string) => staff.find((s) => s.id === id)?.name ?? id;

  if (loading) return null;
  if (requests.length === 0) return null;

  return (
    <div
      className="mb-3 p-3 rounded"
      style={{ background: 'var(--accent-pale)', border: '1px solid var(--accent)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="font-bold" style={{ color: 'var(--accent)' }}>
          🔔 シフト変更申請 {requests.length}件 承認待ち
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {requests.map((r) => (
          <li
            key={r.id}
            className="p-2 rounded flex items-center justify-between gap-2 text-sm"
            style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
          >
            <div className="flex flex-col gap-0.5 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{getStaffName(r.employee_id)}</span>
                <span style={{ color: 'var(--ink-3)' }}>
                  {format(new Date(r.target_date), 'M月d日(E)', { locale: ja })}
                </span>
                <Badge variant="neutral">{TYPE_LABELS[r.change_type]}</Badge>
              </div>
              <div className="text-xs" style={{ color: 'var(--ink-2)' }}>
                {r.change_type === 'time' && 'start_time' in r.requested_payload && (
                  <>
                    希望: {r.requested_payload.start_time}〜{r.requested_payload.end_time}
                  </>
                )}
                {r.change_type !== 'time' && 'assignment_type' in r.requested_payload && (
                  <>
                    希望: {ASSIGNMENT_LABELS[r.requested_payload.assignment_type]}
                    {r.requested_payload.start_time &&
                      ` / ${r.requested_payload.start_time}〜${r.requested_payload.end_time}`}
                  </>
                )}
                {r.reason && <span style={{ color: 'var(--ink-3)' }}> — {r.reason}</span>}
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setSelected(r);
                setAdminNote('');
              }}
            >
              詳細
            </Button>
          </li>
        ))}
      </ul>

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="申請の確認">
        {selected && (
          <div className="flex flex-col gap-3">
            <div className="text-sm">
              <div>
                <strong>申請者:</strong> {getStaffName(selected.employee_id)}
              </div>
              <div>
                <strong>対象日:</strong>{' '}
                {format(new Date(selected.target_date), 'yyyy年M月d日(E)', { locale: ja })}
              </div>
              <div>
                <strong>種類:</strong> {TYPE_LABELS[selected.change_type]}
              </div>
              {selected.reason && (
                <div>
                  <strong>理由:</strong> {selected.reason}
                </div>
              )}
            </div>

            <div
              className="p-2 rounded text-xs"
              style={{ background: 'var(--bg)', border: '1px solid var(--rule)' }}
            >
              <div className="font-bold mb-1">変更前 → 変更後</div>
              <div style={{ color: 'var(--ink-2)' }}>
                {selected.snapshot_before ? (
                  <>
                    {ASSIGNMENT_LABELS[selected.snapshot_before.assignment_type ?? 'normal']}
                    {selected.snapshot_before.start_time && selected.snapshot_before.end_time && (
                      <>
                        {' '}
                        {selected.snapshot_before.start_time}〜{selected.snapshot_before.end_time}
                      </>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--ink-3)' }}>（現状シフトなし）</span>
                )}
                {' → '}
                {selected.change_type === 'time' && 'start_time' in selected.requested_payload && (
                  <>
                    出勤 {selected.requested_payload.start_time}〜
                    {selected.requested_payload.end_time}
                  </>
                )}
                {selected.change_type !== 'time' && 'assignment_type' in selected.requested_payload && (
                  <>
                    {ASSIGNMENT_LABELS[selected.requested_payload.assignment_type]}
                    {selected.requested_payload.start_time &&
                      ` ${selected.requested_payload.start_time}〜${selected.requested_payload.end_time}`}
                  </>
                )}
              </div>
            </div>

            {canApprove && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                  管理者メモ（任意）
                </label>
                <input
                  type="text"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  className="px-2 py-1 rounded text-sm"
                  style={{ border: '1px solid var(--rule)' }}
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelected(null)}>
                閉じる
              </Button>
              {canApprove && (
                <>
                  <Button variant="secondary" onClick={() => handleReview('reject')} disabled={busy}>
                    却下
                  </Button>
                  <Button variant="primary" onClick={() => handleReview('approve')} disabled={busy}>
                    承認
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
