'use client';

/**
 * マトリクス（スプレッドシート）データ入力グリッド
 * DocMerge MatrixGrid.tsx ベース — folder機能除去、templateIdベース、sonner toast
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import MatrixCell from './MatrixCell';
import { evaluateCell } from '@/lib/formula/evaluator';
import { toast } from 'sonner';
import type { PdfTag } from '@/lib/types';

interface Props {
  templateId: string;
  tags: PdfTag[];
  initialRows: { row_index: number; row_data: Record<string, string> }[];
  onTagsGenerated?: () => void;
  onRowsChange?: (rows: Record<string, string>[]) => void;
  onExport?: (rowIndex?: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function MatrixGrid({
  templateId,
  tags,
  initialRows,
  onTagsGenerated,
  onRowsChange,
  onExport,
  onDirtyChange,
}: Props) {
  // 列ヘッダー: タグから取得 + 新規列
  const [columns, setColumns] = useState<
    { key: string; name: string; isNew?: boolean }[]
  >(() => {
    const fromTags = tags.map((t) => ({ key: t.column_key, name: t.display_name }));
    if (fromTags.length === 0) {
      return [
        { key: 'new_1', name: '', isNew: true },
        { key: 'new_2', name: '', isNew: true },
        { key: 'new_3', name: '', isNew: true },
      ];
    }
    return fromTags;
  });

  // 行データ
  const [rows, setRows] = useState<Record<string, string>[]>(() => {
    if (initialRows.length === 0) return [{}];
    return initialRows.map((r) => r.row_data);
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ブラウザ離脱時の未保存警告
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // ソート状態
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // ドラッグ状態
  const dragColRef = useRef<number | null>(null);
  const dragRowRef = useRef<number | null>(null);
  const [dropColIdx, setDropColIdx] = useState<number | null>(null);
  const [dropRowIdx, setDropRowIdx] = useState<number | null>(null);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  function updateRows(updated: Record<string, string>[]) {
    setRows(updated);
    onRowsChange?.(updated);
    markDirty();
  }

  // セル値を解決（数式パーサー用）
  const resolveCell = useCallback(
    (ref: string): string => {
      const colLetter = ref.replace(/[0-9]/g, '');
      const rowNum = parseInt(ref.replace(/[^0-9]/g, ''), 10) - 1;
      const colIdx = colLetter.charCodeAt(0) - 65;
      if (colIdx < 0 || colIdx >= columns.length || rowNum < 0 || rowNum >= rows.length) return '';
      const colKey = columns[colIdx].key;
      const rawValue = rows[rowNum][colKey] ?? '';
      if (rawValue.startsWith('=')) return evaluateCell(rawValue, () => '');
      return rawValue;
    },
    [columns, rows]
  );

  function getDisplayValue(rawValue: string): string {
    if (!rawValue) return '';
    if (rawValue.startsWith('=')) return evaluateCell(rawValue, resolveCell);
    return rawValue;
  }

  // ヘッダー・セル変更
  function handleHeaderChange(colIdx: number, name: string) {
    const updated = [...columns];
    updated[colIdx] = { ...updated[colIdx], name };
    setColumns(updated);
    markDirty();
  }

  function handleCellChange(rowIdx: number, colKey: string, value: string) {
    const updated = [...rows];
    updated[rowIdx] = { ...updated[rowIdx], [colKey]: value };
    updateRows(updated);
  }

  // 行操作
  function addRow() { updateRows([...rows, {}]); }

  function deleteRow(rowIdx: number) {
    if (rows.length <= 1) { toast.warning('最低1行は必要です'); return; }
    updateRows(rows.filter((_, i) => i !== rowIdx));
  }

  // 列操作
  function addColumn() {
    setColumns([...columns, { key: `new_${Date.now()}`, name: '', isNew: true }]);
    markDirty();
  }

  function deleteColumn(colIdx: number) {
    if (columns.length <= 1) { toast.warning('最低1列は必要です'); return; }
    const col = columns[colIdx];
    if (!confirm(`列「${col.name || '(未入力)'}」を削除しますか？`)) return;
    setColumns(columns.filter((_, i) => i !== colIdx));
    updateRows(rows.map((row) => {
      const { [col.key]: _, ...rest } = row;
      return rest;
    }));
  }

  // ソート
  function handleSort(colKey: string) {
    let dir: 'asc' | 'desc' = 'asc';
    if (sortCol === colKey) {
      if (sortDir === 'asc') dir = 'desc';
      else { setSortCol(null); return; }
    }
    setSortCol(colKey);
    setSortDir(dir);
    const sorted = [...rows].sort((a, b) => {
      const va = a[colKey] ?? '';
      const vb = b[colKey] ?? '';
      return dir === 'asc' ? va.localeCompare(vb, 'ja') : vb.localeCompare(va, 'ja');
    });
    updateRows(sorted);
  }

  // 列ドラッグ&ドロップ
  function handleColDragStart(colIdx: number) { dragColRef.current = colIdx; }
  function handleColDragOver(e: React.DragEvent, colIdx: number) {
    if (dragColRef.current === null) return;
    e.preventDefault();
    setDropColIdx(colIdx);
  }
  function handleColDragLeave() { setDropColIdx(null); }
  function handleColDrop(toIdx: number) {
    const fromIdx = dragColRef.current;
    dragColRef.current = null;
    setDropColIdx(null);
    if (fromIdx === null || fromIdx === toIdx) return;
    const newCols = [...columns];
    const [moved] = newCols.splice(fromIdx, 1);
    newCols.splice(toIdx, 0, moved);
    setColumns(newCols);
    markDirty();
  }
  function handleColDragEnd() { dragColRef.current = null; setDropColIdx(null); }

  // 行ドラッグ&ドロップ
  function handleRowDragStart(rowIdx: number) { dragRowRef.current = rowIdx; }
  function handleRowDragOver(e: React.DragEvent, rowIdx: number) {
    if (dragRowRef.current === null) return;
    e.preventDefault();
    setDropRowIdx(rowIdx);
  }
  function handleRowDragLeave() { setDropRowIdx(null); }
  function handleRowDrop(toIdx: number) {
    const fromIdx = dragRowRef.current;
    dragRowRef.current = null;
    setDropRowIdx(null);
    if (fromIdx === null || fromIdx === toIdx) return;
    const updated = [...rows];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    updateRows(updated);
  }
  function handleRowDragEnd() { dragRowRef.current = null; setDropRowIdx(null); }

  // 保存（タグ自動生成 + データ保存）
  async function handleSave() {
    setSaving(true);
    let rowsToSave = rows;

    // 新しい列ヘッダーがあればタグを自動生成
    const newNames = columns.filter((c) => c.isNew && c.name.trim()).map((c) => c.name.trim());

    if (newNames.length > 0) {
      const tagRes = await fetch('/api/documents/pdf-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId, display_names: newNames }),
      });

      if (tagRes.ok) {
        const tagData = await tagRes.json();
        const newCols: { key: string; name: string }[] = tagData.tags.map((t: PdfTag) => ({
          key: t.column_key,
          name: t.display_name,
        }));

        // 旧キー→新キーのマッピング
        const keyMap: Record<string, string> = {};
        for (const oldCol of columns) {
          const matched = newCols.find((nc) => nc.name === oldCol.name);
          if (matched && oldCol.key !== matched.key) keyMap[oldCol.key] = matched.key;
        }

        if (Object.keys(keyMap).length > 0) {
          rowsToSave = rows.map((row) => {
            const newRow: Record<string, string> = {};
            for (const [k, v] of Object.entries(row)) {
              newRow[keyMap[k] ?? k] = v;
            }
            return newRow;
          });
          setRows(rowsToSave);
          onRowsChange?.(rowsToSave);
        }

        setColumns(newCols);
        onTagsGenerated?.();
      } else {
        const tagData = await tagRes.json();
        toast.error(tagData.error || 'タグ生成に失敗しました');
        setSaving(false);
        return;
      }
    }

    // マトリクスデータ保存
    const res = await fetch('/api/documents/matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        rows: rowsToSave.map((r, i) => ({ row_index: i, row_data: r })),
      }),
    });

    if (res.ok) {
      setSaved(true);
      setDirty(false);
      toast.success('保存しました');
    } else {
      toast.error('保存に失敗しました');
    }
    setSaving(false);
  }

  // Excelペースト対応
  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    const hasMultiCell = lines.length > 1 || (lines[0]?.includes('\t') ?? false);
    if (!hasMultiCell) return;

    e.preventDefault();
    const parsed = lines.map((line) => line.split('\t'));

    let startRow = rows.length;
    let startCol = 0;
    const target = e.target as HTMLElement;
    const td = target.closest('td[data-row]');
    if (td) {
      startRow = parseInt(td.getAttribute('data-row') ?? '0', 10);
      startCol = parseInt(td.getAttribute('data-col') ?? '0', 10);
    }

    const updated = [...rows];
    for (let r = 0; r < parsed.length; r++) {
      const rowIdx = startRow + r;
      while (rowIdx >= updated.length) updated.push({});
      for (let c = 0; c < parsed[r].length; c++) {
        const colIdx = startCol + c;
        if (colIdx < columns.length) {
          updated[rowIdx] = { ...updated[rowIdx], [columns[colIdx].key]: parsed[r][c] };
        }
      }
    }

    updateRows(updated);
    toast.success(`${parsed.length}行x${parsed[0]?.length ?? 0}列を貼り付けました`);
  }

  const hasActions = !!onExport;
  const extraCols = hasActions ? 3 : 2;

  return (
    <div>
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`h-10 px-4 rounded-md font-medium text-sm transition-all ${
            saved
              ? 'bg-green-600 text-white shadow-sm'
              : 'bg-diletto-blue text-white hover:bg-[#1535a0] shadow-sm'
          } disabled:opacity-50 disabled:pointer-events-none`}
        >
          {saving ? '保存中...' : saved ? '保存済み' : '保存'}
        </button>
        {onExport && (
          <button
            onClick={() => onExport()}
            className="h-10 bg-diletto-blue text-white font-medium px-4 rounded-md hover:bg-[#1535a0] shadow-sm transition-all text-sm"
          >
            PDF出力
          </button>
        )}
        {dirty && !saved && (
          <span className="text-xs text-amber-600 font-medium">未保存の変更あり</span>
        )}
      </div>

      {/* グリッド */}
      <div className="overflow-auto border border-diletto-gray/20 rounded-md bg-white shadow-sm focus:outline-none" tabIndex={0} onPaste={handlePaste}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-12 px-2 py-2 bg-diletto-bg border-b border-r border-diletto-gray/20 text-xs text-diletto-gray-light font-medium">#</th>
              {hasActions && (
                <th className="w-24 px-2 py-2 bg-diletto-bg border-b border-r border-diletto-gray/20 text-xs text-diletto-gray-light font-medium">操作</th>
              )}
              {columns.map((col, colIdx) => (
                <th
                  key={col.key}
                  draggable
                  onDragStart={() => handleColDragStart(colIdx)}
                  onDragOver={(e) => handleColDragOver(e, colIdx)}
                  onDragLeave={handleColDragLeave}
                  onDrop={() => handleColDrop(colIdx)}
                  onDragEnd={handleColDragEnd}
                  className={`min-w-[140px] border-b border-r border-diletto-gray/20 p-0 relative group ${
                    dropColIdx === colIdx ? 'bg-diletto-blue/10' : ''
                  }`}
                >
                  <div className="flex items-center">
                    <span className="shrink-0 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-diletto-gray-light opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="12" r="1.2"/><circle cx="7" cy="12" r="1.2"/></svg>
                    </span>
                    <div className="flex-1 min-w-0">
                      <MatrixCell value={col.name} displayValue={col.name || 'クリックして入力'} onChange={(v) => handleHeaderChange(colIdx, v)} onBlur={() => {}} isHeader />
                    </div>
                    <div className="shrink-0 flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleSort(col.key)} title="ソート" className="p-0.5 rounded hover:bg-diletto-blue/10 text-diletto-gray-light hover:text-diletto-blue transition-all">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          {sortCol === col.key && sortDir === 'desc' ? <path d="M6 2v8M3 7l3 3 3-3" /> : <path d="M6 10V2M3 5l3-3 3 3" />}
                        </svg>
                      </button>
                      <button onClick={() => deleteColumn(colIdx)} title="列を削除" className="p-0.5 rounded hover:bg-diletto-red/10 text-diletto-gray-light hover:text-diletto-red transition-all">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                      </button>
                    </div>
                  </div>
                  {sortCol === col.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-diletto-blue" />}
                </th>
              ))}
              <th className="w-10 px-2 py-2 bg-diletto-bg border-b border-diletto-gray/20 text-center cursor-pointer hover:bg-diletto-blue/5 transition-all" onClick={addColumn} title="列を追加">
                <span className="text-lg text-diletto-gray-light hover:text-diletto-blue">+</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className={dropRowIdx === rowIdx ? 'bg-diletto-blue/5' : ''}>
                <td
                  draggable
                  onDragStart={() => handleRowDragStart(rowIdx)}
                  onDragOver={(e) => handleRowDragOver(e, rowIdx)}
                  onDragLeave={handleRowDragLeave}
                  onDrop={() => handleRowDrop(rowIdx)}
                  onDragEnd={handleRowDragEnd}
                  className="px-1 py-1 bg-diletto-bg border-b border-r border-diletto-gray/20 text-xs text-diletto-gray-light text-center font-mono cursor-grab active:cursor-grabbing group/row select-none"
                >
                  <div className="flex items-center justify-center gap-0.5">
                    <span>{rowIdx + 1}</span>
                    <button onClick={() => deleteRow(rowIdx)} title="行を削除" className="p-0.5 rounded opacity-0 group-hover/row:opacity-100 hover:bg-diletto-red/10 text-diletto-gray-light hover:text-diletto-red transition-all">
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                    </button>
                  </div>
                </td>
                {hasActions && (
                  <td className="px-1 py-1 bg-diletto-bg border-b border-r border-diletto-gray/20">
                    <div className="flex items-center gap-1">
                      {onExport && (
                        <button onClick={() => onExport(rowIdx)} title="PDF出力" className="text-xs px-1.5 py-0.5 rounded text-diletto-gray hover:text-green-600 hover:bg-green-50 transition-all">
                          PDF
                        </button>
                      )}
                    </div>
                  </td>
                )}
                {columns.map((col, colIdx) => (
                  <td key={`${rowIdx}-${col.key}`} data-row={rowIdx} data-col={colIdx} className="border-b border-r border-diletto-gray/20 p-0">
                    <MatrixCell value={row[col.key] ?? ''} displayValue={getDisplayValue(row[col.key] ?? '')} onChange={(v) => handleCellChange(rowIdx, col.key, v)} onBlur={() => {}} />
                  </td>
                ))}
                <td className="border-b border-diletto-gray/20" />
              </tr>
            ))}
            <tr>
              <td colSpan={columns.length + extraCols} className="px-2 py-2 bg-diletto-bg text-center cursor-pointer hover:bg-diletto-blue/5 transition-all" onClick={addRow} title="行を追加">
                <span className="text-lg text-diletto-gray-light hover:text-diletto-blue">+</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
