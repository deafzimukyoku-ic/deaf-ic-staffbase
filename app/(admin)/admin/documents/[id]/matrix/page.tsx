'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import MatrixGrid from '@/components/admin/MatrixGrid';
import type { DocumentTemplate, PdfTag, MatrixRow } from '@/lib/types';

export default function MatrixPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;
  const supabase = createClient();

  const [template, setTemplate] = useState<DocumentTemplate | null>(null);
  const [tags, setTags] = useState<PdfTag[]>([]);
  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [tplRes, tagsRes, rowsRes] = await Promise.all([
        supabase.from('document_templates').select('*').eq('id', templateId).single(),
        fetch(`/api/documents/pdf-tags?template_id=${templateId}`).then((r) => r.json()),
        fetch(`/api/documents/matrix?template_id=${templateId}`).then((r) => r.json()),
      ]);

      if (tplRes.data) setTemplate(tplRes.data as DocumentTemplate);
      if (tagsRes.tags) setTags(tagsRes.tags);
      if (rowsRes.rows) setMatrixRows(rowsRes.rows);
      setLoading(false);
    }
    load();
  }, [templateId]);

  const handleTagsGenerated = useCallback(() => {
    // タグが再生成されたら最新を取得
    fetch(`/api/documents/pdf-tags?template_id=${templateId}`)
      .then((r) => r.json())
      .then((data) => { if (data.tags) setTags(data.tags); });
  }, [templateId]);

  const handleExport = useCallback((rowIndex?: number) => {
    // フェーズ6で実装するエクスポートモーダルを呼び出す
    // 現時点ではAPIを直接呼び出す簡易版
    const url = `/api/documents/matrix-export`;
    const body = {
      template_id: templateId,
      mode: rowIndex !== undefined ? 'single' : 'all',
      row_index: rowIndex,
    };

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error || 'エクスポートに失敗しました');
        }
        const blob = await res.blob();
        const fileName = res.headers.get('X-Filename') || 'output.pdf';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => {
        alert(err.message);
      });
  }, [templateId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-brand-gray-light">読み込み中...</p>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-12">
        <p className="text-brand-gray">テンプレートが見つかりません</p>
      </div>
    );
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/admin/documents')}
            className="text-sm text-brand-gray hover:text-brand-ink transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold">{template.name}</h1>
            <p className="text-sm text-brand-gray">マトリクスデータ入力</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/admin/documents/${templateId}/editor`)}
        >
          エディタに戻る
        </Button>
      </div>

      {/* マトリクスグリッド */}
      <MatrixGrid
        templateId={templateId}
        tags={tags}
        initialRows={matrixRows.map((r) => ({
          row_index: r.row_index,
          row_data: r.row_data,
        }))}
        onTagsGenerated={handleTagsGenerated}
        onExport={handleExport}
      />
    </div>
  );
}
