'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import Modal from '@/components/shift-compat/Modal';
import Button from '@/components/shift-compat/Button';
import { createClient } from '@/lib/supabase/client';
import type {
  ShiftAssignmentType,
  ShiftChangeRequestType,
  ShiftChangeRequestPayload,
} from '@/lib/types';

/**
 * 社員側 シフト変更申請フォーム（タスクE）
 *
 * - 申請種別: 時刻変更 / 休暇申請 / 勤務種別変更
 * - shift_change_requests に直接 INSERT（RLS で本人 employee_id のみ書き込み可）
 * - 申請承認は admin の ApprovalQueueFull 経由（タスクA で実装済）
 */

interface CurrentShift {
  assignment_type: ShiftAssignmentType;
  start_time: string | null;
  end_time: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  // 申請対象
  tenantId: string;
  facilityId: string;
  employeeId: string;
  targetDate: string; // YYYY-MM-DD
  currentShift: CurrentShift | null;
}

const TYPE_OPTIONS: Array<{ value: ShiftChangeRequestType; label: string; description: string }> = [
  { value: 'time',        label: '時刻変更',     description: '出勤/退勤時刻のみ変更したい' },
  { value: 'leave',       label: '休暇申請',     description: '出勤予定だったが休みにしたい（公休/有給）' },
  { value: 'type_change', label: '勤務種別変更', description: '出勤↔︎休みなど、種別自体を変えたい' },
];

const ASSIGNMENT_LABELS: Record<ShiftAssignmentType, string> = {
  normal: '出勤',
  public_holiday: '公休',
  paid_leave: '有給',
  off: '休み',
};

export default function ShiftChangeRequestForm({
  isOpen,
  onClose,
  onSubmitted,
  tenantId,
  facilityId,
  employeeId,
  targetDate,
  currentShift,
}: Props) {
  const supabase = createClient();
  const [changeType, setChangeType] = useState<ShiftChangeRequestType>('time');

  // time payload
  const [startTime, setStartTime] = useState(currentShift?.start_time?.slice(0, 5) ?? '09:00');
  const [endTime, setEndTime] = useState(currentShift?.end_time?.slice(0, 5) ?? '17:00');

  // leave / type_change payload
  const [leaveType, setLeaveType] = useState<ShiftAssignmentType>('paid_leave');
  const [typeChangeType, setTypeChangeType] = useState<ShiftAssignmentType>('off');
  const [typeChangeStartTime, setTypeChangeStartTime] = useState(currentShift?.start_time?.slice(0, 5) ?? '');
  const [typeChangeEndTime, setTypeChangeEndTime] = useState(currentShift?.end_time?.slice(0, 5) ?? '');

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      let requested_payload: ShiftChangeRequestPayload;
      if (changeType === 'time') {
        if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
          throw new Error('時刻は HH:MM 形式で入力してください');
        }
        requested_payload = { start_time: startTime, end_time: endTime };
      } else if (changeType === 'leave') {
        // leave 申請は assignment_type を public_holiday / paid_leave / off に変更
        requested_payload = { assignment_type: leaveType };
      } else {
        // type_change 申請: 任意の種別 + normal の場合のみ時刻
        const payload: { assignment_type: ShiftAssignmentType; start_time?: string | null; end_time?: string | null } = {
          assignment_type: typeChangeType,
        };
        if (typeChangeType === 'normal') {
          if (!/^\d{2}:\d{2}$/.test(typeChangeStartTime) || !/^\d{2}:\d{2}$/.test(typeChangeEndTime)) {
            throw new Error('時刻は HH:MM 形式で入力してください');
          }
          payload.start_time = typeChangeStartTime;
          payload.end_time = typeChangeEndTime;
        }
        requested_payload = payload;
      }

      // snapshot_before: 現状のシフトを記録（差分表示用）
      const snapshot_before = currentShift
        ? {
            assignment_type: currentShift.assignment_type,
            start_time: currentShift.start_time,
            end_time: currentShift.end_time,
          }
        : null;

      const { error: insErr } = await supabase.from('shift_change_requests').insert({
        tenant_id: tenantId,
        facility_id: facilityId,
        employee_id: employeeId,
        target_date: targetDate,
        change_type: changeType,
        requested_payload,
        snapshot_before,
        reason: reason.trim() || null,
        status: 'pending',
      });

      if (insErr) throw new Error('申請の送信に失敗しました: ' + insErr.message);

      onSubmitted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`シフト変更申請 — ${format(new Date(targetDate), 'yyyy年M月d日（E）', { locale: ja })}`}
    >
      <div className="space-y-4">
        {/* 現状表示 */}
        <div className="rounded-md bg-diletto-beige p-3">
          <div className="text-xs font-bold text-diletto-gray-light mb-1">現状のシフト</div>
          {currentShift ? (
            <div className="text-sm">
              <span className="font-bold">{ASSIGNMENT_LABELS[currentShift.assignment_type]}</span>
              {currentShift.assignment_type === 'normal' && currentShift.start_time && currentShift.end_time && (
                <span className="ml-2 text-diletto-gray">
                  {currentShift.start_time.slice(0, 5)}〜{currentShift.end_time.slice(0, 5)}
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm text-diletto-gray">未設定</div>
          )}
        </div>

        {/* 申請種別選択 */}
        <div>
          <div className="text-xs font-bold text-diletto-gray-light mb-1.5">申請の種類</div>
          <div className="space-y-1">
            {TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition ${
                  changeType === opt.value
                    ? 'border-diletto-blue bg-diletto-blue/5'
                    : 'border-diletto-gray/15 hover:bg-diletto-blue/5'
                }`}
              >
                <input
                  type="radio"
                  name="change_type"
                  value={opt.value}
                  checked={changeType === opt.value}
                  onChange={() => setChangeType(opt.value)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-bold">{opt.label}</div>
                  <div className="text-xs text-diletto-gray">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 詳細入力 */}
        <div className="rounded-md bg-white border border-diletto-gray/15 p-3 space-y-3">
          {changeType === 'time' && (
            <div>
              <div className="text-xs font-bold text-diletto-gray-light mb-1.5">希望の勤務時間</div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="text-sm rounded-md px-2 py-1 border border-diletto-gray/20 outline-none focus:border-diletto-blue/40"
                />
                <span className="text-diletto-gray">〜</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="text-sm rounded-md px-2 py-1 border border-diletto-gray/20 outline-none focus:border-diletto-blue/40"
                />
              </div>
            </div>
          )}

          {changeType === 'leave' && (
            <div>
              <div className="text-xs font-bold text-diletto-gray-light mb-1.5">休暇種別</div>
              <div className="flex gap-2">
                {(['paid_leave', 'public_holiday', 'off'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLeaveType(t)}
                    className={`px-3 py-1.5 text-sm rounded-md border transition ${
                      leaveType === t
                        ? 'border-diletto-blue bg-diletto-blue/10 text-diletto-blue font-bold'
                        : 'border-diletto-gray/20 hover:bg-diletto-blue/5'
                    }`}
                  >
                    {ASSIGNMENT_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {changeType === 'type_change' && (
            <>
              <div>
                <div className="text-xs font-bold text-diletto-gray-light mb-1.5">変更後の種別</div>
                <div className="flex gap-2 flex-wrap">
                  {(['normal', 'paid_leave', 'public_holiday', 'off'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTypeChangeType(t)}
                      className={`px-3 py-1.5 text-sm rounded-md border transition ${
                        typeChangeType === t
                          ? 'border-diletto-blue bg-diletto-blue/10 text-diletto-blue font-bold'
                          : 'border-diletto-gray/20 hover:bg-diletto-blue/5'
                      }`}
                    >
                      {ASSIGNMENT_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              {typeChangeType === 'normal' && (
                <div>
                  <div className="text-xs font-bold text-diletto-gray-light mb-1.5">勤務時間</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={typeChangeStartTime}
                      onChange={(e) => setTypeChangeStartTime(e.target.value)}
                      className="text-sm rounded-md px-2 py-1 border border-diletto-gray/20"
                    />
                    <span className="text-diletto-gray">〜</span>
                    <input
                      type="time"
                      value={typeChangeEndTime}
                      onChange={(e) => setTypeChangeEndTime(e.target.value)}
                      className="text-sm rounded-md px-2 py-1 border border-diletto-gray/20"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 理由 */}
        <div>
          <label className="text-xs font-bold text-diletto-gray-light block mb-1">理由（任意）</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            rows={2}
            placeholder="管理者に共有する理由があれば記入してください"
            className="w-full text-sm rounded-md px-3 py-2 border border-diletto-gray/15 outline-none focus:border-diletto-blue/40"
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '送信中...' : '申請する'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
