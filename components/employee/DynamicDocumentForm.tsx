'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PlaceholderMapping } from '@/lib/types';

interface Props {
  templateName: string;
  mapping: PlaceholderMapping[];
  formData: Record<string, string>;
  onChange: (formData: Record<string, string>) => void;
  docxPath?: string;
}

export function DynamicDocumentForm({ templateName, mapping, formData, onChange, docxPath }: Props) {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function loadPreview() {
    if (!docxPath || previewHtml !== null) {
      setPreviewOpen(!previewOpen);
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/documents/preview?path=${encodeURIComponent(docxPath)}`);
      const data = await res.json();
      setPreviewHtml(data.html || '<p>プレビューを取得できませんでした</p>');
    } catch {
      setPreviewHtml('<p>プレビューを取得できませんでした</p>');
    }
    setPreviewLoading(false);
  }

  // form_data タイプのみ表示（社員入力項目）
  const formFields = mapping.filter((m) => m.source_type === 'form_data');

  function update(key: string, value: string) {
    onChange({ ...formData, [key]: value });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{templateName}</CardTitle>
          {docxPath && (
            <button
              onClick={loadPreview}
              className="text-xs text-brand-blue hover:underline transition-colors"
            >
              {previewOpen ? '閉じる' : '書類プレビュー'}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* プレビュー */}
        {previewOpen && (
          <div className="border border-brand-gray/15 rounded-md p-4 bg-white max-h-[400px] overflow-y-auto">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-5 w-5 border-2 border-brand-blue border-t-transparent rounded-full" />
                <span className="ml-2 text-sm text-brand-gray">読み込み中...</span>
              </div>
            ) : (
              <div
                className="prose prose-sm max-w-none text-brand-ink"
                dangerouslySetInnerHTML={{ __html: previewHtml || '' }}
              />
            )}
          </div>
        )}

        {/* フォーム */}
        {formFields.length === 0 ? (
          <p className="text-sm text-brand-gray-light">この書類は入力項目がありません（自動差し込みのみ）</p>
        ) : (
          formFields.map((f, i) => (
            <div key={`${f.key}-${i}`} className="space-y-2">
              <Label>
                {f.label || f.key}
                {f.required && <span className="text-brand-red ml-1">*</span>}
              </Label>

              {(() => {
                const fieldKey = f.source_field || f.key;
                if (f.input_type === 'textarea') {
                  return (
                    <Textarea
                      value={formData[fieldKey] || ''}
                      onChange={(e) => update(fieldKey, e.target.value)}
                      rows={3}
                    />
                  );
                }
                if (f.input_type === 'select') {
                  return (
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={formData[fieldKey] || ''}
                      onChange={(e) => update(fieldKey, e.target.value)}
                    >
                      <option value="">選択...</option>
                      {(f.options || []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  );
                }
                return (
                  <Input
                    type={f.input_type === 'date' ? 'date' : f.input_type === 'number' ? 'number' : 'text'}
                    value={formData[fieldKey] || ''}
                    onChange={(e) => update(fieldKey, e.target.value)}
                  />
                );
              })()}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
