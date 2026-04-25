'use client';

/**
 * 社員側 PDF 書類フォーム
 * form_data 入力項目の表示 + PDFダウンロード
 */

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import type { PlaceholderMapping } from '@/lib/types';

interface Props {
  templateId: string;
  templateName: string;
  employeeId: string;
  mapping: PlaceholderMapping[];
  formData: Record<string, string>;
  onChange: (formData: Record<string, string>) => void;
}

export function PdfDocumentForm({
  templateId,
  templateName,
  employeeId,
  mapping,
  formData,
  onChange,
}: Props) {
  const [downloading, setDownloading] = useState(false);

  // form_data タイプのみ表示（社員入力項目）
  const formFields = mapping.filter((m) => m.source_type === 'form_data');

  function update(key: string, value: string) {
    onChange({ ...formData, [key]: value });
  }

  async function handleDownloadPdf() {
    setDownloading(true);
    try {
      const res = await fetch('/api/documents/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          template_id: templateId,
          form_data: formData,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'PDF生成に失敗しました');
      }

      const blob = await res.blob();
      const fileName = res.headers.get('X-Filename') || `${templateName}.pdf`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF生成に失敗しました');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{templateName}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={downloading}
          >
            {downloading ? '生成中...' : 'PDFダウンロード'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {formFields.length === 0 ? (
          <p className="text-sm text-diletto-gray-light">
            この書類は入力項目がありません（社員プロフィールから自動差し込み）
          </p>
        ) : (
          formFields.map((f, i) => (
            <div key={`${f.key}-${i}`} className="space-y-2">
              <Label>
                {f.label || f.key}
                {f.required && <span className="text-diletto-red ml-1">*</span>}
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
