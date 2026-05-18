'use client';

/* 173: /my/documents 上部「会社から届いた書類」セクション (在籍社員のみ)
   - 新しい順 / プレビュー (iframe) / DL / 受領確認
   - 取り消し済はグレーアウト + 操作不可 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface Row {
  id: string;
  issued_at: string;
  issued_by_name: string;
  acknowledged_at: string | null;
  revoked_at: string | null;
  message: string | null;
  template_name: string;
  document_template_id: string;
}

export function IssuedDocumentsSection() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    /* ⚠ RLS は「本人 OR 管轄 admin/manager」を SELECT 許可しているため、
       admin / manager がこのページを開くと管轄全社員の発行履歴が混入する。
       /my/documents は『自分宛』を見せる場所なので、auth.user → employees.id を引いて
       明示的に employee_id でフィルタする (RLS には頼らない)。 */
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRows([]); setLoading(false); return; }
    const { data: meRow } = await supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!meRow) { setRows([]); setLoading(false); return; }

    const { data } = await supabase
      .from('issued_documents')
      .select('id, issued_at, issued_by_name, acknowledged_at, revoked_at, message, delivery_mode, document_template_id')
      .eq('employee_id', meRow.id)
      .eq('delivery_mode', 'in_app')
      .order('issued_at', { ascending: false });
    const list = (data ?? []) as Array<Row & { delivery_mode: string }>;
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
    setRows(list.map((r) => ({ ...r, template_name: nameMap.get(r.document_template_id) ?? '(テンプレ削除済)' })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAcknowledge(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/issued-documents/${id}/acknowledge`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '受領確認に失敗しました');
      toast.success('受領を確認しました');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '受領確認 失敗');
    } finally {
      setBusyId(null);
    }
  }

  function handleDownload(id: string, name: string) {
    /* PDF ルートは inline で返るが <a download> で強制 DL */
    const a = document.createElement('a');
    a.href = `/api/issued-documents/${id}/pdf`;
    a.download = `${name}.pdf`;
    a.click();
  }

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <div className="mb-6">
      <Card>
        <CardContent className="py-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            📨 会社から届いた書類
            <Badge variant="outline" className="text-[10px]">{rows.length} 件</Badge>
          </h2>
          <ul className="space-y-2">
            {rows.map((r) => {
              const isRevoked = !!r.revoked_at;
              const isOpen = previewId === r.id;
              return (
                <li
                  key={r.id}
                  className={'border rounded-md ' + (isRevoked ? 'opacity-60 bg-muted/30' : '')}
                >
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{r.template_name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          発行: {new Date(r.issued_at).toLocaleString('ja-JP')} / {r.issued_by_name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {isRevoked
                            ? <Badge variant="outline" className="text-[10px] text-red-700 border-red-300">取り消されました</Badge>
                            : r.acknowledged_at
                              ? <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300">受領済</Badge>
                              : <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">未確認</Badge>}
                        </div>
                        {r.message && (
                          <p className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap">💬 {r.message}</p>
                        )}
                      </div>
                      {!isRevoked && (
                        <div className="flex items-center gap-1 shrink-0 flex-wrap">
                          <Button
                            size="sm"
                            variant={isOpen ? 'default' : 'outline'}
                            onClick={() => setPreviewId(isOpen ? null : r.id)}
                          >
                            {isOpen ? '閉じる' : 'プレビュー'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDownload(r.id, r.template_name)}>
                            DL
                          </Button>
                          {!r.acknowledged_at && (
                            <Button
                              size="sm"
                              onClick={() => handleAcknowledge(r.id)}
                              disabled={busyId === r.id}
                            >
                              受け取りました
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {isOpen && !isRevoked && (
                    <div className="border-t p-2">
                      <iframe
                        src={`/api/issued-documents/${r.id}/pdf`}
                        title={r.template_name}
                        className="w-full rounded-md border"
                        style={{ height: '70vh' }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
