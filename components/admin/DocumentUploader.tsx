'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MAX_DOCX_FILE_SIZE_MB } from '@/lib/constants';
import { toast } from 'sonner';

interface Props {
  onUploaded: (file: File, placeholders: string[]) => void;
  loading: boolean;
}

export function DocumentUploader({ onUploaded, loading }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleParse() {
    if (!file) return;
    setParsing(true);

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/documents/parse', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error || '解析に失敗しました');
      setParsing(false);
      return;
    }

    if (data.placeholders.length === 0) {
      toast.warning('プレースホルダが見つかりませんでした（{{key}} 形式で記述してください）');
    }

    onUploaded(file, data.placeholders);
    setParsing(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!f.name.endsWith('.docx')) {
      toast.error('.docx ファイルのみ対応しています');
      return;
    }

    const maxBytes = MAX_DOCX_FILE_SIZE_MB * 1024 * 1024;
    if (f.size > maxBytes) {
      toast.error(`ファイルサイズは${MAX_DOCX_FILE_SIZE_MB}MB以下にしてください`);
      return;
    }

    setFile(f);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>書類テンプレートをアップロード</CardTitle>
        <CardDescription>
          .docx ファイル（最大{MAX_DOCX_FILE_SIZE_MB}MB）をアップロードしてください。
          {'{{key_name}}'} 形式のプレースホルダが自動検出されます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>docx ファイル</Label>
          <Input
            ref={inputRef}
            type="file"
            accept=".docx"
            onChange={handleFileChange}
          />
        </div>
        {file && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-diletto-gray">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
            <Button onClick={handleParse} disabled={parsing || loading} size="sm">
              {parsing ? '解析中...' : 'プレースホルダを検出'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
