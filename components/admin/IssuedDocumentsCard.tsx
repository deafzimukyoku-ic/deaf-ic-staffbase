'use client';

/* 173: 社員詳細「書類」タブ用 — 会社→社員 発行履歴カード
   - 新しい順で表示 / 取り消し / DL / メール送信失敗の警告 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { IssueDocumentDialog } from './IssueDocumentDialog';

interface Props {
  employee: {
    id: string;
    last_name: string | null;
    first_name: string | null;
    status: string;
    email: string | null;
  };
}

interface Row {
  id: string;
  issued_at: string;
  issued_by_name: string;
  delivery_mode: 'in_app' | 'email_only';
  email_sent_at: string | null;
  email_to_address: string | null;
  email_error: string | null;
  acknowledged_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  message: string | null;
  template_name: string;
}

export function IssuedDocumentsCard({ employee }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [openIssue, setOpenIssue] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('issued_documents')
      .select('id, issued_at, issued_by_name, delivery_mode, email_sent_at, email_to_address, email_error, acknowledged_at, revoked_at, revoked_reason, message, document_template_id')
      .eq('employee_id', employee.id)
      .order('issued_at', { ascending: false });
    const list = (data ?? []) as Array<Row & { document_template_id: string }>;
    if (list.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    const tids = Array.from(new Set(list.map((r) => r.document_template_id)));
    const { data: tpls } = await supabase
      .from('document_templates')
      .select('id, name')
      .in('id', tids);
    const nameMap = new Map((tpls ?? []).map((t) => [t.id as string, t.name as string]));
    setRows(list.map((r) => ({ ...r, template_name: nameMap.get(r.document_template_id) ?? '(削除済テンプレ)' })));
    setLoading(false);
  }, [supabase, employee.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRevoke(id: string) {
    if (!confirm('この書類を取り消しますか？社員からは閲覧・DL できなくなります。')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/issued-documents/${id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '取り消しに失敗しました');
      toast.success('取り消しました');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取り消し失敗');
    } finally {
      setBusyId(null);
    }
  }

  function handleOpenPdf(id: string) {
    window.open(`/api/issued-documents/${id}/pdf`, '_blank', 'noopener');
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold">会社から発行した書類</h3>
          <Button size="sm" onClick={() => setOpenIssue(true)}>+ 書類を発行</Button>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground">読み込み中...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">まだ発行履歴はありません</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const isRevoked = !!r.revoked_at;
              const isEmail = r.delivery_mode === 'email_only';
              return (
                <li
                  key={r.id}
                  className={'border rounded-md p-3 ' + (isRevoked ? 'opacity-60 bg-muted/30' : '')}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{r.template_name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        発行: {new Date(r.issued_at).toLocaleString('ja-JP')} / 発行者: {r.issued_by_name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {isRevoked && <Badge variant="outline" className="text-[10px] text-red-700 border-red-300">取り消し済</Badge>}
                        {isEmail
                          ? r.email_sent_at
                            ? <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300">メール送信済</Badge>
                            : <Badge variant="outline" className="text-[10px] text-red-700 border-red-300">メール送信失敗</Badge>
                          : r.acknowledged_at
                            ? <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300">受領確認済</Badge>
                            : <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">未確認</Badge>}
                        {isEmail && r.email_to_address && (
                          <span className="text-[10px] text-muted-foreground">→ {r.email_to_address}</span>
                        )}
                      </div>
                      {r.message && (
                        <p className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap">💬 {r.message}</p>
                      )}
                      {r.email_error && (
                        <p className="text-[11px] text-red-700 mt-1">エラー: {r.email_error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isRevoked && (
                        <Button size="sm" variant="outline" onClick={() => handleOpenPdf(r.id)}>
                          PDF
                        </Button>
                      )}
                      {!isRevoked && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRevoke(r.id)}
                          disabled={busyId === r.id}
                          className="text-red-700 border-red-200 hover:bg-red-50"
                        >
                          取り消し
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <IssueDocumentDialog
          open={openIssue}
          onOpenChange={setOpenIssue}
          employee={employee}
          onIssued={load}
        />
      </CardContent>
    </Card>
  );
}
