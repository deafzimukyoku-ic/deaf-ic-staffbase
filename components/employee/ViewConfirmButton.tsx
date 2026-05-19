'use client';

/**
 * 「✓ 確認しました（N 回目）」ボタン。
 * 4 ページ共通: 遵守事項 / 研修 / お知らせ / 業務マニュアル の詳細モーダル内で使用。
 *
 * 旧仕様: モーダルを開いた瞬間に自動 logView していた → 何も読まずクリックしても 1 回扱いだった。
 * 新仕様: 明示的にこのボタンをクリックした時だけ view_logs に行追加。回数も日付もボタン横に表示。
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { logView, type ViewLogTable, type ViewSummary } from '@/lib/view-log';
import { notifyBadgeRefresh } from '@/lib/badge-refresh';

interface Props {
  table: ViewLogTable;
  tenantId: string;
  employeeId: string;
  itemId: string;
  /** 初期表示時の確認状況 (ロード時に集計したもの)。 */
  initialSummary?: ViewSummary;
  /** クリックでカウントが増えたら親に通知（一覧側のバッジ更新等で使用） */
  onConfirmed?: (newCount: number, viewedAt: string) => void;
}

export function ViewConfirmButton({ table, tenantId, employeeId, itemId, initialSummary, onConfirmed }: Props) {
  const [summary, setSummary] = useState<ViewSummary>(initialSummary ?? { count: 0, lastAt: null });
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleClick() {
    setLoading(true);
    try {
      await logView(supabase, table, {
        tenant_id: tenantId,
        employee_id: employeeId,
        item_id: itemId,
      });
      const now = new Date().toISOString();
      const newCount = summary.count + 1;
      setSummary({ count: newCount, lastAt: now });
      onConfirmed?.(newCount, now);
      notifyBadgeRefresh(); /* layout の赤バッジに即時反映 (ButtonClick → layout の useEffect は走らないため) */
      toast.success(`確認を記録しました (${newCount} 回目)`);
    } finally {
      setLoading(false);
    }
  }

  const nextOrdinal = summary.count + 1;
  const lastViewedLabel = summary.lastAt
    ? new Date(summary.lastAt).toLocaleString('ja-JP', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      {summary.count > 0 && lastViewedLabel && (
        <p className="text-xs text-brand-gray-light text-right">
          前回確認: {lastViewedLabel}（これまで {summary.count} 回確認済み）
        </p>
      )}
      <Button
        onClick={handleClick}
        disabled={loading}
        className="bg-brand-blue hover:bg-brand-blue/90 text-white font-bold"
      >
        {loading ? '記録中...' : `✓ 確認しました（${nextOrdinal} 回目）`}
      </Button>
    </div>
  );
}
