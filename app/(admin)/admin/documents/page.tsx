'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MAX_DOCUMENTS_PER_TENANT } from '@/lib/constants';
import { DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { DocumentTemplate } from '@/lib/types';

export default function DocumentsPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [samples, setSamples] = useState<DocumentTemplate[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplate | null>(null);
  const [deleteSubCount, setDeleteSubCount] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const supabase = createClient();

  async function loadTemplates() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: me } = await supabase
      .from('employees')
      .select('tenant_id')
      .eq('auth_user_id', user.id)
      .single();

    if (!me) return;
    setTenantId(me.tenant_id);

    const [myTemplates, sampleTemplates] = await Promise.all([
      supabase.from('document_templates').select('*').eq('tenant_id', me.tenant_id).order('display_order'),
      supabase.from('document_templates').select('*').is('tenant_id', null).eq('is_sample', true).order('display_order'),
    ]);

    setTemplates((myTemplates.data as DocumentTemplate[]) || []);
    setSamples((sampleTemplates.data as DocumentTemplate[]) || []);
    setLoading(false);
  }

  useEffect(() => { loadTemplates(); }, []);

  async function handleAddSample(sample: DocumentTemplate) {
    if (!tenantId) return;
    setAdding(sample.id);

    // テンプレートをコピー（PDF関連カラム含む）
    const { data: inserted, error } = await supabase.from('document_templates').insert({
      tenant_id: tenantId,
      name: sample.name,
      template_type: sample.template_type,
      pdf_storage_path: sample.pdf_storage_path,
      page_count: sample.page_count,
      docx_storage_path: sample.docx_storage_path,
      mapping: sample.mapping,
      is_sample: false,
      display_order: templates.length + 1,
    }).select('id').single();

    if (error || !inserted) {
      toast.error('追加に失敗しました', { description: error?.message });
      setAdding(null);
      return;
    }

    // PDFテンプレートの場合、タグと配置もコピー
    if (sample.template_type === 'pdf') {
      const newTemplateId = inserted.id;

      // タグを取得
      const { data: srcTags } = await supabase
        .from('pdf_tags')
        .select('*')
        .eq('template_id', sample.id);

      if (srcTags && srcTags.length > 0) {
        // タグをコピー（新IDを生成）
        const tagIdMap = new Map<string, string>();
        const newTags = srcTags.map((t) => {
          const newId = crypto.randomUUID();
          tagIdMap.set(t.id, newId);
          return {
            id: newId,
            template_id: newTemplateId,
            column_key: t.column_key,
            display_name: t.display_name,
          };
        });

        await supabase.from('pdf_tags').insert(newTags);

        // 配置を取得してコピー
        const { data: srcPlacements } = await supabase
          .from('pdf_tag_placements')
          .select('*')
          .eq('template_id', sample.id);

        if (srcPlacements && srcPlacements.length > 0) {
          const newPlacements = srcPlacements.map((p) => ({
            template_id: newTemplateId,
            tag_id: tagIdMap.get(p.tag_id) || p.tag_id,
            page_number: p.page_number,
            x: p.x,
            y: p.y,
            font_size: p.font_size,
          }));

          await supabase.from('pdf_tag_placements').insert(newPlacements);
        }
      }
    }

    toast.success(`「${sample.name}」を追加しました`);
    await loadTemplates();
    setAdding(null);
  }

  async function openDeleteDialog(template: DocumentTemplate) {
    const { count } = await supabase
      .from('document_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('document_template_id', template.id);

    setDeleteSubCount(count || 0);
    setDeleteTarget(template);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    // 1. 関連する提出データを先に削除（FK制約にCASCADEなし）
    if (deleteSubCount > 0) {
      const { error: subErr } = await supabase
        .from('document_submissions')
        .delete()
        .eq('document_template_id', deleteTarget.id);

      if (subErr) {
        toast.error('提出データの削除に失敗しました', { description: subErr.message });
        setDeleting(false);
        return;
      }
    }

    // 2. テンプレートレコードを削除
    const { error: tplErr } = await supabase
      .from('document_templates')
      .delete()
      .eq('id', deleteTarget.id);

    if (tplErr) {
      toast.error('テンプレートの削除に失敗しました', { description: tplErr.message });
      setDeleting(false);
      return;
    }

    // 3. Storageのファイルを削除（失敗しても続行）
    const storagePath = deleteTarget.pdf_storage_path || deleteTarget.docx_storage_path;
    if (storagePath) {
      await supabase.storage
        .from('documents')
        .remove([storagePath]);
    }

    toast.success(`「${deleteTarget.name}」を削除しました`);
    setDeleteTarget(null);
    setDeleting(false);
    await loadTemplates();
  }

  // 既にテナントに追加済みのサンプル名を除外
  const availableSamples = samples.filter(
    (s) => !templates.some((t) => t.name === s.name)
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">書類テンプレート</h1>
          <p className="text-sm text-diletto-gray mt-1">
            {loading ? '読み込み中...' : `${templates.length} / ${MAX_DOCUMENTS_PER_TENANT} 件`}
          </p>
        </div>
        {templates.length < MAX_DOCUMENTS_PER_TENANT && (
          <div className="flex gap-2">
            <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
              <DialogTrigger className="inline-flex shrink-0 items-center justify-center rounded-md border border-diletto-gray/30 bg-white text-diletto-ink shadow-sm hover:border-diletto-ink/60 text-sm font-medium h-10 px-4 transition-all duration-300">
                📋 カタログから追加
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>テンプレートカタログ</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-diletto-gray mb-4">
                  用意されたテンプレートから選んで追加できます。
                </p>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {availableSamples.length === 0 ? (
                    <p className="text-sm text-diletto-gray-light text-center py-6">
                      追加できるテンプレートはありません
                    </p>
                  ) : (
                    availableSamples.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-md border border-diletto-gray/10 p-3">
                        <div>
                          <p className="text-sm font-medium">{s.name}</p>
                          <p className="text-xs text-diletto-gray">
                            {s.template_type === 'pdf' ? `${s.page_count || 1}ページ` : `${(s.mapping as unknown[]).length} フィールド`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={adding === s.id || templates.length >= MAX_DOCUMENTS_PER_TENANT}
                          onClick={() => handleAddSample(s)}
                        >
                          {adding === s.id ? '追加中...' : '+ 追加'}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Link href="/admin/documents/new-pdf">
              <Button>📑 PDFアップロード</Button>
            </Link>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{t.name}</p>
                <div className="flex gap-2 mt-1">
                  <Badge variant="default" className="text-xs">PDF</Badge>
                  {t.page_count && (
                    <span className="text-xs text-diletto-gray-light">
                      {t.page_count}ページ
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {t.pdf_storage_path && (
                  <>
                    <Link href={`/admin/documents/${t.id}/editor`}>
                      <Button variant="outline" size="sm">エディタ</Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const res = await fetch('/api/documents/bulk-pdf-zip-employee', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ template_id: t.id }),
                        });
                        if (!res.ok) {
                          const json = await res.json();
                          toast.error(json.error || '一括出力に失敗しました');
                          return;
                        }
                        const blob = await res.blob();
                        const fileName = res.headers.get('X-Filename') || 'output.zip';
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = fileName;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      一括PDF出力
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-diletto-red border-diletto-red/30 hover:bg-diletto-red/5"
                  onClick={() => openDeleteDialog(t)}
                >
                  削除
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {!loading && templates.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-diletto-gray-light">
              書類テンプレートがありません。「+ テンプレート追加」から登録してください。
            </CardContent>
          </Card>
        )}
      </div>
      {/* 削除確認ダイアログ */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>テンプレートの削除</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-diletto-gray">
              「<span className="font-medium text-diletto-ink">{deleteTarget?.name}</span>」を削除します。
            </p>
            {deleteSubCount > 0 && (
              <div className="rounded-md border border-diletto-red/20 bg-diletto-red/[0.04] p-3">
                <p className="text-sm text-diletto-red font-medium">
                  この書類には {deleteSubCount} 件の提出データがあります。
                </p>
                <p className="text-xs text-diletto-red/80 mt-1">
                  削除すると社員の提出データも全て失われます。この操作は取り消せません。
                </p>
              </div>
            )}
            {deleteSubCount === 0 && (
              <p className="text-xs text-diletto-gray-light">提出データはありません。</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              キャンセル
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-diletto-red hover:bg-[#7a2828] text-white"
            >
              {deleting ? '削除中...' : '削除する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
