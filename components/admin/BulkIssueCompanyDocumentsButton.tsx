'use client';

/* 174: 「会社発行用書類を在籍社員に一括発行」ボタン + 確認モーダル + 結果表示
   - GET /api/issued-documents/bulk-issue でドライラン (発行予定件数取得)
   - POST /api/issued-documents/bulk-issue で実発行
   - 重複防止 = 取り消し済も含めて未発行とみなす (revoked_at IS NULL の発行が無い組合せだけ発行) */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface PlanItem {
  template_id: string;
  template_name: string;
  employee_count: number;
}

export function BulkIssueCompanyDocumentsButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [plan, setPlan] = useState<{ total: number; items: PlanItem[] } | null>(null);

  async function openDialog() {
    setOpen(true);
    setPlan(null);
    setLoading(true);
    try {
      const res = await fetch('/api/issued-documents/bulk-issue');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '取得失敗');
      setPlan({ total: json.total ?? 0, items: json.items ?? [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '発行予定の取得に失敗しました');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setIssuing(true);
    try {
      const res = await fetch('/api/issued-documents/bulk-issue', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '発行失敗');
      if (json.failed > 0) {
        toast.warning(`発行 ${json.issued} 件 / 失敗 ${json.failed} 件`);
      } else {
        toast.success(`発行 ${json.issued} 件 完了`);
      }
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '一括発行に失敗しました');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={openDialog} className="gap-1 whitespace-nowrap">
        <span>📨</span> 会社発行書類を一括発行
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[92vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>会社発行書類の一括発行</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              「会社発行用」に設定済みのテンプレートを、まだ受け取っていない在籍社員に一括で発行します。
            </p>
          </DialogHeader>

          {loading ? (
            <p className="text-xs text-muted-foreground py-6 text-center">発行予定を集計中...</p>
          ) : !plan ? null : plan.total === 0 ? (
            <div className="text-xs text-muted-foreground py-4 space-y-2">
              <p>未発行の組合せはありません (会社発行用テンプレートが無いか、対象社員全員に既に発行済みです)。</p>
              <p>新しいテンプレを会社発行用にしたい場合は <span className="font-mono">/admin/documents</span> でチェックを ON にしてください。</p>
            </div>
          ) : (
            <div className="space-y-2 py-1">
              <p className="text-sm">
                発行予定: <span className="font-bold text-emerald-700">{plan.total} 件</span>
              </p>
              <ul className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-1 text-xs">
                {plan.items.filter((i) => i.employee_count > 0).map((i) => (
                  <li key={i.template_id} className="flex justify-between gap-2">
                    <span className="truncate">{i.template_name}</span>
                    <span className="shrink-0 text-muted-foreground">→ {i.employee_count} 名</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                同じ社員 × 同じテンプレで「取り消されていない発行」が既に存在する場合は skip されます。
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={issuing}>
              キャンセル
            </Button>
            {plan && plan.total > 0 && (
              <Button onClick={handleConfirm} disabled={issuing}>
                {issuing ? '発行中...' : `${plan.total} 件 発行する`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
