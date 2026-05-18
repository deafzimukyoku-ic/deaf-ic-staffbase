'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PdfTemplateUploader } from '@/components/admin/PdfTemplateUploader';
import { toast } from 'sonner';

export default function NewPdfDocumentPage() {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  function handleFileSelected(f: File) {
    setFile(f);
    if (!name) setName(f.name.replace(/\.pdf$/i, ''));
  }

  async function handleSave() {
    if (!file || !name.trim()) return;
    setSaving(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name.trim());
    formData.append('data_mode', 'employee');

    const res = await fetch('/api/documents/upload-pdf', {
      method: 'POST',
      body: formData,
    });

    const json = await res.json();

    if (!res.ok) {
      toast.error('アップロードに失敗しました', { description: json.error });
      setSaving(false);
      return;
    }

    toast.success('PDFテンプレートを登録しました');
    router.push(`/admin/documents/${json.template.id}/editor`);
  }

  return (
    <div>
      <button
        onClick={() => router.push('/admin/documents')}
        className="flex items-center gap-1 text-sm text-brand-gray hover:text-brand-ink transition-colors mb-4"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        書類テンプレートに戻る
      </button>
      <h1 className="text-2xl font-bold mb-6">PDFテンプレート追加</h1>

      <div className="space-y-6">
        <PdfTemplateUploader
          onFileSelected={handleFileSelected}
          disabled={saving}
        />

        {file && (
          <>
            <div className="rounded-md border border-brand-gray/20 p-3">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-brand-gray mt-1">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>

            <div className="space-y-2">
              <Label>書類名</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="請求書テンプレート"
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => router.push('/admin/documents')}
              >
                キャンセル
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="flex-1"
              >
                {saving ? 'アップロード中...' : '保存してエディタへ'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
