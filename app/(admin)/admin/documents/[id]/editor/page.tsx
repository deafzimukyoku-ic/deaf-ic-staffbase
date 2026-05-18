'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import dynamic_import from 'next/dynamic';
import type { DocumentTemplate, PdfTag, PdfTagPlacement } from '@/lib/types';

// Fabric.js は SSR 不可のため dynamic import
const PdfEditor = dynamic_import(() => import('@/components/admin/PdfEditor'), { ssr: false });
import PdfEditorToolbar from '@/components/admin/PdfEditorToolbar';

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;
  const supabase = createClient();

  const [template, setTemplate] = useState<DocumentTemplate | null>(null);
  const [tags, setTags] = useState<PdfTag[]>([]);
  const [placements, setPlacements] = useState<PdfTagPlacement[]>([]);
  const [selectedPlacement, setSelectedPlacement] = useState<PdfTagPlacement | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // データ読み込み
  useEffect(() => {
    async function load() {
      const [tplRes, tagsRes, placementsRes] = await Promise.all([
        supabase.from('document_templates').select('*').eq('id', templateId).single(),
        fetch(`/api/documents/pdf-tags?template_id=${templateId}`).then((r) => r.json()),
        supabase.from('pdf_tag_placements').select('*').eq('template_id', templateId).order('page_number'),
      ]);

      if (tplRes.data) {
        setTemplate(tplRes.data as DocumentTemplate);

        // PDF の signed URL を取得
        if (tplRes.data.pdf_storage_path) {
          const { data: urlData, error: urlErr } = await supabase.storage
            .from('documents')
            .createSignedUrl(tplRes.data.pdf_storage_path, 3600);
          if (urlErr) {
            console.error('[editor] Signed URL error:', urlErr.message, 'path:', tplRes.data.pdf_storage_path);
          }
          if (urlData?.signedUrl) {
            console.log('[editor] PDF URL obtained:', urlData.signedUrl.substring(0, 80) + '...');
            setPdfUrl(urlData.signedUrl);
          } else {
            console.error('[editor] No signed URL returned for path:', tplRes.data.pdf_storage_path);
          }
        } else {
          console.error('[editor] No pdf_storage_path on template');
        }
      }

      if (tagsRes.tags) setTags(tagsRes.tags);
      if (placementsRes.data) setPlacements(placementsRes.data as PdfTagPlacement[]);
    }
    load();
  }, [templateId]);

  const handlePlacementsChange = useCallback((updated: PdfTagPlacement[]) => {
    setPlacements(updated);
    setDirty(true);
  }, []);

  const handleSelectPlacement = useCallback((p: PdfTagPlacement | null) => {
    setSelectedPlacement(p);
  }, []);

  function handleFontSizeChange(placementId: string, fontSize: number) {
    setPlacements((prev) =>
      prev.map((p) => (p.id === placementId ? { ...p, font_size: fontSize } : p))
    );
    setSelectedPlacement((prev) =>
      prev && prev.id === placementId ? { ...prev, font_size: fontSize } : prev
    );
    setDirty(true);
  }

  function handleDeletePlacement(placementId: string) {
    setPlacements((prev) => prev.filter((p) => p.id !== placementId));
    setSelectedPlacement(null);
    setDirty(true);
  }

  async function handleAddTags(items: { displayName: string; columnKey?: string }[]) {
    if (items.length === 0) return;
    const body: Record<string, unknown> = {
      template_id: templateId,
      display_names: items.map((i) => i.displayName),
    };
    /* 全アイテムが columnKey 持ち（社員モード）か、全部無し（matrix モード）のどちらかを想定。
       UI 側で揃えて呼ぶので途中で混在しない前提。 */
    if (items[0].columnKey) {
      body.column_keys = items.map((i) => i.columnKey ?? '');
    }
    const res = await fetch('/api/documents/pdf-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error('タグの追加に失敗しました', { description: json.error });
      return;
    }
    setTags(json.tags);
    if (items.length === 1) {
      toast.success(`タグ「${items[0].displayName}」を追加しました`);
    } else {
      toast.success(`${items.length} 件のタグを追加しました`);
    }
  }

  async function handleDeleteTag(tagId: string) {
    // 関連する配置も削除
    setPlacements((prev) => prev.filter((p) => p.tag_id !== tagId));

    const res = await fetch(`/api/documents/pdf-tags?tag_id=${tagId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('タグの削除に失敗しました');
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    setSelectedPlacement(null);
    setDirty(true);
    toast.success('タグを削除しました');
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch('/api/documents/save-placements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        placements: placements.map((p) => ({
          tag_id: p.tag_id,
          page_number: p.page_number,
          x: p.x,
          y: p.y,
          font_size: p.font_size,
        })),
      }),
    });
    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      toast.error('保存に失敗しました', { description: json.error });
      return;
    }

    setPlacements(json.placements);
    setDirty(false);
    toast.success('配置を保存しました');
  }

  async function handlePreview() {
    if (dirty) {
      toast.error('先に保存してからプレビューしてください');
      return;
    }
    setPreviewLoading(true);
    try {
      /* プレビューはダミーデータで生成。実社員データに依存しないので、
         先方環境にまだ社員が1人もいなくても全タグの見栄えを確認できる。 */
      const res = await fetch('/api/documents/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId, preview: true }),
      });
      if (!res.ok) { toast.error('プレビュー生成に失敗しました'); return; }
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('プレビュー生成中にエラーが発生しました');
    } finally {
      setPreviewLoading(false);
    }
  }

  // 未保存警告
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  if (!template || !pdfUrl) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-brand-gray-light">読み込み中...</p>
      </div>
    );
  }

  return (
    <>
      <div className="h-[calc(100vh-64px)] flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 h-12 border-b border-brand-gray/10 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/admin/documents')}
              className="text-sm text-brand-gray hover:text-brand-ink transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h1 className="text-sm font-semibold truncate">{template.name}</h1>
            {dirty && (
              <span className="text-[10px] text-brand-gray bg-brand-bg px-1.5 py-0.5 rounded">未保存</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>

        {/* メイン: エディタ + サイドバー */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden">
            <PdfEditor
              pdfUrl={pdfUrl}
              tags={tags}
              placements={placements}
              onPlacementsChange={handlePlacementsChange}
              onSelectPlacement={handleSelectPlacement}
              selectedPlacementId={selectedPlacement?.id ?? null}
            />
          </div>
          <PdfEditorToolbar
            tags={tags}
            placements={placements}
            selectedPlacement={selectedPlacement}
            onFontSizeChange={handleFontSizeChange}
            onDeletePlacement={handleDeletePlacement}
            onAddTags={handleAddTags}
            onDeleteTag={handleDeleteTag}
            onPreview={handlePreview}
            previewLoading={previewLoading}
          />
        </div>
      </div>

      {/* サンプルプレビュー */}
      {previewUrl && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl flex flex-col" style={{ height: '95vh' }}>
            <div className="flex items-center justify-between px-4 h-12 border-b border-brand-gray/10 shrink-0">
              <h2 className="text-sm font-semibold">サンプルプレビュー</h2>
              <button
                onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                className="text-brand-gray hover:text-brand-ink transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <iframe src={previewUrl} className="flex-1 w-full min-h-0" title="サンプルプレビュー" />
          </div>
        </div>
      )}
    </>
  );
}
