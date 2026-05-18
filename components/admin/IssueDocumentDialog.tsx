'use client';

/* 173: 書類発行 (会社→社員) モーダル
   - PDF テンプレ選択 (タグ配置済みのみ有効)
   - コメント on-off (チェックボックスで textarea 表示)
   - プレビュー (既存 /api/documents/generate-pdf を流用、iframe 表示)
   - 退職社員警告バッジ (email NULL なら発行ボタン disabled)
   - 発行 → /api/issued-documents/create */

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: {
    id: string;
    last_name: string | null;
    first_name: string | null;
    status: string;
    email: string | null;
  };
  onIssued?: () => void;
}

interface TemplateRow {
  id: string;
  name: string;
  template_type: string;
  data_mode: string | null;
  pdf_storage_path: string | null;
  placementCount: number;
}

export function IssueDocumentDialog({ open, onOpenChange, employee, onIssued }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const isRetired = employee.status === 'retired';
  const fullName = `${employee.last_name ?? ''} ${employee.first_name ?? ''}`.trim();

  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [withMessage, setWithMessage] = useState(false);
  const [message, setMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [issuing, setIssuing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedId('');
    setWithMessage(false);
    setMessage('');
    setPreviewUrl(null);
    (async () => {
      const { data: tpls } = await supabase
        .from('document_templates')
        .select('id, name, template_type, data_mode, pdf_storage_path, tenant_id')
        .eq('template_type', 'pdf')
        .order('display_order');
      const list = (tpls ?? []) as Array<TemplateRow & { tenant_id: string }>;
      if (list.length === 0) {
        setTemplates([]);
        setLoading(false);
        return;
      }
      const ids = list.map((t) => t.id);
      const { data: pls } = await supabase
        .from('pdf_tag_placements')
        .select('template_id')
        .in('template_id', ids);
      const countByTpl = new Map<string, number>();
      for (const p of pls ?? []) {
        const tid = (p as { template_id: string }).template_id;
        countByTpl.set(tid, (countByTpl.get(tid) ?? 0) + 1);
      }
      setTemplates(
        list
          .filter((t) => t.data_mode !== 'matrix')
          .map((t) => ({ ...t, placementCount: countByTpl.get(t.id) ?? 0 }))
      );
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [open, supabase]);

  /* プレビュー: 選択中テンプレで /api/documents/generate-pdf を叩いて iframe 表示 */
  useEffect(() => {
    if (!selectedId) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      return;
    }
    let canceled = false;
    setPreviewing(true);
    (async () => {
      try {
        const res = await fetch('/api/documents/generate-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employee_id: employee.id, template_id: selectedId, form_data: {} }),
        });
        if (!res.ok) throw new Error('プレビュー生成に失敗しました');
        const blob = await res.blob();
        if (canceled) return;
        const url = URL.createObjectURL(blob);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(url);
      } catch (e) {
        if (!canceled) toast.error(e instanceof Error ? e.message : 'プレビュー失敗');
      } finally {
        if (!canceled) setPreviewing(false);
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* unmount 時にプレビュー URL を revoke */
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = templates.find((t) => t.id === selectedId);
  const placementMissing = selected != null && selected.placementCount === 0;
  const retiredNoEmail = isRetired && !employee.email;
  const canIssue = !!selectedId && !placementMissing && !retiredNoEmail && !issuing;

  async function handleIssue() {
    if (!selectedId) return;
    setIssuing(true);
    try {
      const res = await fetch('/api/issued-documents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employee.id,
          template_id: selectedId,
          message: withMessage ? message : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? '発行に失敗しました');
      }
      if (json.delivery_mode === 'email_only') {
        if (json.email_sent) toast.success('退職社員にメール送信しました');
        else toast.error(`メール送信失敗: ${json.email_error ?? '不明なエラー'}`);
      } else {
        toast.success('書類を発行しました');
      }
      onIssued?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '発行に失敗しました');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>書類を発行する</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            宛先: <span className="font-medium">{fullName || '(名前未設定)'}</span>
          </p>
        </DialogHeader>

        {isRetired && (
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs px-3 py-2">
            ⚠ この社員は<strong>退職済</strong>です。
            {employee.email
              ? <>発行すると <span className="font-mono">{employee.email}</span> にメール添付で送信されます。</>
              : <>メールアドレスが未登録のため発行できません。</>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {/* テンプレ選択 */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">テンプレート</label>
            {loading ? (
              <p className="text-xs text-muted-foreground">読み込み中...</p>
            ) : templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">発行可能な PDF テンプレートがありません</p>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto border rounded-md p-2">
                {templates.map((t) => {
                  const disabled = t.placementCount === 0 || !t.pdf_storage_path;
                  return (
                    <label
                      key={t.id}
                      className={
                        'flex items-center gap-2 text-xs cursor-pointer rounded px-2 py-1 ' +
                        (disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/40')
                      }
                    >
                      <input
                        type="radio"
                        name="tpl"
                        value={t.id}
                        checked={selectedId === t.id}
                        disabled={disabled}
                        onChange={() => setSelectedId(t.id)}
                      />
                      <span className="flex-1 truncate">{t.name}</span>
                      {disabled && (
                        <Badge variant="outline" className="text-[10px]">タグ配置なし</Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* コメント on-off */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={withMessage}
                onChange={(e) => setWithMessage(e.target.checked)}
              />
              <span>コメントを添える</span>
            </label>
            {withMessage && (
              <Textarea
                rows={3}
                placeholder="社員に伝えたい一言 (任意)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                className="text-xs"
              />
            )}
          </div>

          {/* プレビュー */}
          {selectedId && (
            <div>
              <p className="text-xs font-medium text-foreground mb-1">プレビュー</p>
              {previewing ? (
                <div className="h-72 flex items-center justify-center border rounded-md text-xs text-muted-foreground">
                  生成中...
                </div>
              ) : previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="preview"
                  className="w-full rounded-md border"
                  style={{ height: '50vh' }}
                />
              ) : (
                <div className="h-72 flex items-center justify-center border rounded-md text-xs text-muted-foreground">
                  プレビュー失敗
                </div>
              )}
            </div>
          )}
        </div>

        <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t bg-muted/50 p-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={issuing}>
            キャンセル
          </Button>
          <Button size="sm" onClick={handleIssue} disabled={!canIssue}>
            {issuing ? '発行中...' : isRetired ? 'メールで送信' : '発行する'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
