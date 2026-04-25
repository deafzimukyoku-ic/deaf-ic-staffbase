'use client';

/**
 * PDFインポートモーダル（shift-puzzle 忠実移植）
 * フロー: アップロード → 解析中 → 確認テーブル → 確定で onConfirm 呼び出し
 */

import React, { useState, useRef } from 'react';
import Modal from '@/components/shift-compat/Modal';
import Button from '@/components/shift-compat/Button';
import Badge from '@/components/shift-compat/Badge';
import PdfConfirmTable from '@/components/shift/PdfConfirmTable';
import type { ChildRow, ParsedScheduleEntry, AreaLabel } from '@/lib/types';
import { inferMarkFromTime, mergeAreas } from '@/lib/shift-logic/resolveTransportSpec';

type PdfImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (entries: ParsedScheduleEntry[]) => void;
  childList: ChildRow[];
  pickupAreas?: AreaLabel[];
  dropoffAreas?: AreaLabel[];
};

/**
 * 解析結果にマーク（pickup_mark / dropoff_mark）を付与。
 */
function assignMarks(
  entries: ParsedScheduleEntry[],
  childList: ChildRow[],
  pickupAreas: AreaLabel[],
  dropoffAreas: AreaLabel[],
): ParsedScheduleEntry[] {
  const nameToChild = new Map(childList.map((c) => [c.name, c]));
  return entries.map((e) => {
    if (e.pickup_mark !== undefined && e.dropoff_mark !== undefined) return e;
    const child = nameToChild.get(e.child_name);
    if (!child) return { ...e, pickup_mark: null, dropoff_mark: null };
    const mergedPickup = mergeAreas(pickupAreas, child.custom_pickup_areas);
    const mergedDropoff = mergeAreas(dropoffAreas, child.custom_dropoff_areas);
    const pickup =
      e.pickup_mark ?? inferMarkFromTime(child.pickup_area_labels, mergedPickup, e.pickup_time);
    const dropoff =
      e.dropoff_mark ?? inferMarkFromTime(child.dropoff_area_labels, mergedDropoff, e.dropoff_time);
    return { ...e, pickup_mark: pickup, dropoff_mark: dropoff };
  });
}

type ImportState = 'idle' | 'uploading' | 'confirm' | 'saving';

export default function PdfImportModal({
  isOpen,
  onClose,
  onConfirm,
  childList,
  pickupAreas = [],
  dropoffAreas = [],
}: PdfImportModalProps) {
  const [state, setState] = useState<ImportState>('idle');
  const [entries, setEntries] = useState<ParsedScheduleEntry[]>([]);
  const [isMock, setIsMock] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError('');
    setState('uploading');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/shifts/import-pdf', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'PDF解析に失敗しました');
      }

      const withMarks = assignMarks(data.entries, childList, pickupAreas, dropoffAreas);
      setEntries(withMarks);
      setIsMock(data.isMock);
      setState('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setState('idle');
    }
  };

  const handleConfirm = () => {
    setState('saving');
    onConfirm(entries);
    setTimeout(() => {
      setState('idle');
      setEntries([]);
      setFileName('');
      onClose();
    }, 500);
  };

  const handleReset = () => {
    setState('idle');
    setEntries([]);
    setError('');
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        handleReset();
        onClose();
      }}
      title="PDFインポート"
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {state === 'idle' && (
          <>
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              デイロボの利用予定PDFをアップロードしてください。
              Claude AIが自動で児童名・日付・時間を読み取ります。
            </p>

            <label
              className="flex flex-col items-center justify-center gap-2 py-10 cursor-pointer transition-colors hover:bg-[var(--accent-pale)]"
              style={{
                border: '2px dashed var(--rule-strong)',
                borderRadius: '8px',
                background: 'var(--bg)',
              }}
            >
              <span className="text-2xl">📄</span>
              <span className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
                クリックしてPDFを選択
              </span>
              <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                PDF形式・10MB以下
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            {error && (
              <p
                className="text-xs font-medium px-3 py-2"
                style={{
                  color: 'var(--red)',
                  background: 'var(--red-pale)',
                  borderRadius: '4px',
                }}
              >
                {error}
              </p>
            )}
          </>
        )}

        {state === 'uploading' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div
              className="w-10 h-10 rounded-full animate-spin"
              style={{ border: '3px solid var(--rule)', borderTopColor: 'var(--accent)' }}
            />
            <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
              {fileName} を解析中...
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
              Claude AIがPDFを読み取っています
            </p>
          </div>
        )}

        {state === 'confirm' && (
          <>
            <div className="flex items-center gap-3">
              <Badge variant="success">{entries.length}件 検出</Badge>
              {isMock && <Badge variant="warning">モックデータ（API未接続）</Badge>}
              <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                {fileName}
              </span>
            </div>

            <PdfConfirmTable
              entries={entries}
              onEntriesChange={setEntries}
              childList={childList}
              pickupAreas={pickupAreas}
              dropoffAreas={dropoffAreas}
            />

            <div className="flex gap-2 mt-2">
              <Button variant="secondary" onClick={handleReset}>
                やり直す
              </Button>
              <Button variant="primary" onClick={handleConfirm}>
                この内容で登録する
              </Button>
            </div>
          </>
        )}

        {state === 'saving' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div
              className="w-10 h-10 rounded-full animate-spin"
              style={{ border: '3px solid var(--rule)', borderTopColor: 'var(--green)' }}
            />
            <p className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
              利用予定を登録中...
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
