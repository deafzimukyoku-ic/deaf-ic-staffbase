'use client';

/**
 * PDF エクスポートモーダル
 * single（1行PDF）/ all（全行ZIP）モード選択
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  templateId: string;
  rowCount: number;
  /** 特定行のエクスポート（行インデックス指定済みの場合） */
  preselectedRowIndex?: number;
}

export default function MatrixExportModal({
  open,
  onClose,
  templateId,
  rowCount,
  preselectedRowIndex,
}: Props) {
  const [mode, setMode] = useState<'single' | 'all'>(
    preselectedRowIndex !== undefined ? 'single' : 'all'
  );
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);

    const body = {
      template_id: templateId,
      mode,
      row_index: mode === 'single' ? (preselectedRowIndex ?? 0) : undefined,
    };

    try {
      const res = await fetch('/api/documents/matrix-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'エクスポートに失敗しました');
      }

      const blob = await res.blob();
      const fileName = res.headers.get('X-Filename') || (mode === 'all' ? 'output.zip' : 'output.pdf');

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'エクスポートに失敗しました');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PDF出力</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-diletto-gray">
            出力モードを選択してください。
          </p>

          <div className="space-y-2">
            {preselectedRowIndex !== undefined && (
              <label className="flex items-center gap-3 rounded-md border border-diletto-gray/20 p-3 cursor-pointer hover:bg-diletto-bg transition-colors">
                <input
                  type="radio"
                  name="exportMode"
                  value="single"
                  checked={mode === 'single'}
                  onChange={() => setMode('single')}
                  className="accent-diletto-blue"
                />
                <div>
                  <p className="text-sm font-medium">1行のみ出力</p>
                  <p className="text-xs text-diletto-gray">
                    行 {(preselectedRowIndex ?? 0) + 1} のPDFをダウンロード
                  </p>
                </div>
              </label>
            )}

            <label className="flex items-center gap-3 rounded-md border border-diletto-gray/20 p-3 cursor-pointer hover:bg-diletto-bg transition-colors">
              <input
                type="radio"
                name="exportMode"
                value="all"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
                className="accent-diletto-blue"
              />
              <div>
                <p className="text-sm font-medium">全行一括出力</p>
                <p className="text-xs text-diletto-gray">
                  {rowCount}行分のPDFをZIPでダウンロード
                </p>
              </div>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            キャンセル
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? '生成中...' : 'ダウンロード'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
