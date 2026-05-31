'use client';

/**
 * 施設シフト（仮 ready / 公開 published）の「✓ 確認しました」ボタン。
 * components/employee/ViewConfirmButton.tsx（お知らせ等）と同じ思想:
 *   - 明示クリックで shift_confirmations に upsert（施設×月×本人）
 *   - 押下後 notifyBadgeRefresh() で layout の赤バッジを即時更新
 *
 * 確認単位は (employee_id, facility_id, month)。当月に ready/published シフトがある
 * facility ぶんを一括 upsert する（兼任で複数施設が同月に出ている場合に対応）。
 * 管理者が再 ready / 再公開すると transition API が当該 (facility, month) を delete し、
 * 未確認（バッジ再点灯）に戻る。
 */
import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/shift-compat/Button';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { notifyBadgeRefresh } from '@/lib/badge-refresh';

interface Props {
  tenantId: string;
  employeeId: string;
  /** 当月に ready/published シフトがある施設 id 群（確認対象） */
  facilityIds: string[];
  /** 'YYYY-MM' */
  month: string;
  /** 表示中の月の段階（ボタン文言の出し分け用） */
  stage: 'ready' | 'published';
}

export default function ShiftConfirmButton({ tenantId, employeeId, facilityIds, month, stage }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null);
  const [confirmedFacIds, setConfirmedFacIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const facKey = facilityIds.join(',');

  /* 既存の確認状況を取得（本人 × 対象施設 × 月） */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (facilityIds.length === 0) return;
      const { data } = await supabase
        .from('shift_confirmations')
        .select('facility_id, confirmed_at')
        .eq('employee_id', employeeId)
        .eq('month', month)
        .in('facility_id', facilityIds);
      if (cancelled) return;
      const rows = (data ?? []) as { facility_id: string; confirmed_at: string }[];
      setConfirmedFacIds(new Set(rows.map((r) => r.facility_id)));
      setLastConfirmedAt(rows.reduce<string | null>((acc, r) => (!acc || r.confirmed_at > acc ? r.confirmed_at : acc), null));
    }
    void load();
    return () => { cancelled = true; };
  }, [supabase, employeeId, month, facKey, facilityIds]);

  /* 対象施設すべてに確認記録があれば「確認済み」 */
  const allConfirmed = facilityIds.length > 0 && facilityIds.every((f) => confirmedFacIds.has(f));

  async function handleClick() {
    if (facilityIds.length === 0) return;
    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const rows = facilityIds.map((fid) => ({
        tenant_id: tenantId,
        facility_id: fid,
        employee_id: employeeId,
        month,
        confirmed_at: nowIso,
      }));
      const { error } = await supabase
        .from('shift_confirmations')
        .upsert(rows, { onConflict: 'employee_id,facility_id,month' });
      if (error) throw error;
      setConfirmedFacIds(new Set(facilityIds));
      setLastConfirmedAt(nowIso);
      notifyBadgeRefresh(); /* layout の赤バッジに即時反映 */
      toast.success('シフトの確認を記録しました');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '確認の記録に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  const lastLabel = lastConfirmedAt
    ? new Date(lastConfirmedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      {allConfirmed && lastLabel && (
        <span className="text-[11px] text-emerald-700 text-right">✓ 確認済み（最終確認 {lastLabel}）</span>
      )}
      <Button variant="primary" onClick={handleClick} disabled={loading || facilityIds.length === 0}>
        {loading ? '記録中...' : allConfirmed ? 'もう一度確認しました' : `✓ ${stage === 'ready' ? '仮シフトを' : 'シフトを'}確認しました`}
      </Button>
    </div>
  );
}
