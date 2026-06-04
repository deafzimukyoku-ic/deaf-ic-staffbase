'use client';

/**
 * Excelコピペインポートモーダル（shift-puzzle 1412行を忠実移植）
 *
 * 対応フォーマット:
 * - 横型（デイロボ/Excel送迎表）: 1行目=日付ヘッダー、以降=児童行
 *   各セルに「迎 13:20\n送 16:00」のような複数行データ
 * - 縦型: 児童名 / 日付 / 迎え / 送り の列
 * - 1児童モード: デイロボ Web 直貼付（30日分縦リスト、空日は空行）
 *
 * Excelでセルに改行がある場合、コピーするとダブルクォートで囲まれる。
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Modal from '@/components/shift-compat/Modal';
import Button from '@/components/shift-compat/Button';
import Badge from '@/components/shift-compat/Badge';
import type { ParsedScheduleEntry } from '@/lib/types';
import type { GradeType } from '@/lib/constants';
import { parseChildName } from '@/lib/shift-utils';

export type ExistingEntrySummary = {
  id: string;
  child_id: string;
  date: string;
  pickup_time: string | null;
  dropoff_time: string | null;
  pickup_method: 'pickup' | 'self';
  dropoff_method: 'dropoff' | 'self';
  pickup_mark: string | null;
  dropoff_mark: string | null;
};

type ExcelPasteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (entries: ParsedScheduleEntry[]) => void;
  year: number;
  month: number;
  /** 児童登録ダイアログで使用（admin の場合 facility 選択肢、manager は固定） */
  tenantId: string;
  facilityId: string;
  existingChildNames?: string[];
  onChildrenRegistered?: () => Promise<void> | void;
  /** 当月の既存利用。完全上書きで「削除される件数」の警告に使用 */
  existingEntries?: ExistingEntrySummary[];
  childNameToId?: Map<string, string>;
};

export default function ExcelPasteModal({
  isOpen,
  onClose,
  onConfirm,
  year,
  month,
  tenantId,
  facilityId,
  existingChildNames = [],
  onChildrenRegistered,
  existingEntries = [],
  childNameToId,
}: ExcelPasteModalProps) {
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedScheduleEntry[]>([]);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'paste' | 'preview'>('paste');
  const [mode, setMode] = useState<'bulk' | 'single'>('bulk');
  const [singleChildName, setSingleChildName] = useState<string>('');

  const handleParse = () => {
    setError('');
    try {
      if (mode === 'single') {
        if (!singleChildName) {
          setError('対象の児童を選択してください。');
          return;
        }
        const singleResult = parseSingleChildVertical(rawText, year, month, singleChildName);
        if (singleResult.error) {
          setError(singleResult.error);
          return;
        }
        if (singleResult.entries.length === 0) {
          setError('有効なセルが見つかりませんでした。30 日分の縦リスト（空日は空行）を貼り付けてください。');
          return;
        }
        setParsed(singleResult.entries);
        setStep('preview');
        return;
      }

      const hasTab = rawText.includes('\t');
      if (!hasTab && rawText.trim().length > 0) {
        const lineCount = rawText.split('\n').filter((l) => l.trim()).length;
        if (lineCount >= 10) {
          setError(
            'タブ区切りが検出できませんでした。\n' +
              'デイロボからブラウザで直接コピーするとタブが抜け、日付と児童の対応が取れません。\n' +
              '\n対処方法:\n' +
              '  ① デイロボの Excel 出力ボタンから Excel を開く → 該当範囲を選択してコピー → ここに貼付（推奨）\n' +
              '  ② もしくは「1児童モード」に切替え、児童を選んでから縦リストを貼付（30日分・空日は空行）',
          );
          return;
        }
      }

      const result = parseExcelClipboard(rawText, year, month);
      if (result.weekdayMismatch) {
        setError(result.weekdayMismatch);
        return;
      }
      if (result.entries.length === 0) {
        setError('有効なデータが見つかりませんでした。Excelの利用予定表をヘッダー行・児童名列を含めてコピーしてください。');
        return;
      }
      setParsed(result.entries);
      setStep('preview');
    } catch {
      setError('データの解析に失敗しました。Excelからそのままコピーしたデータか確認してください。');
    }
  };

  const handleConfirm = () => {
    onConfirm(parsed);
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setRawText('');
    setParsed([]);
    setError('');
    setStep('paste');
  };

  const childNames = [...new Set(parsed.map((e) => e.child_name))];
  const existingSet = new Set(existingChildNames.map((n) => n.trim()));
  const unknownChildNames = childNames.filter((n) => !existingSet.has(n.trim()));
  const [registerOpen, setRegisterOpen] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { handleReset(); onClose(); }}
      title="利用表をペースト"
      size="xl"
    >
      <div className="flex flex-col gap-4">
        {step === 'paste' && (
          <>
            <div className="flex gap-1 text-xs">
              <button
                onClick={() => { setMode('bulk'); setError(''); }}
                className="px-3 py-1.5 rounded-t"
                style={{
                  background: mode === 'bulk' ? 'var(--accent)' : 'var(--white)',
                  color: mode === 'bulk' ? '#fff' : 'var(--ink-2)',
                  fontWeight: mode === 'bulk' ? 600 : 400,
                  borderBottom: mode === 'bulk' ? '2px solid var(--accent)' : '1px solid var(--rule)',
                }}
              >
                一括モード（Excel経由）
              </button>
              <button
                onClick={() => { setMode('single'); setError(''); }}
                className="px-3 py-1.5 rounded-t"
                style={{
                  background: mode === 'single' ? 'var(--accent)' : 'var(--white)',
                  color: mode === 'single' ? '#fff' : 'var(--ink-2)',
                  fontWeight: mode === 'single' ? 600 : 400,
                  borderBottom: mode === 'single' ? '2px solid var(--accent)' : '1px solid var(--rule)',
                }}
              >
                1児童モード（デイロボ直接貼付）
              </button>
            </div>

            {mode === 'bulk' ? (
              <>
                <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  <strong>Excel で開いてから</strong>ヘッダー行と児童名列を含めて範囲選択しコピー（Ctrl+C）、
                  ここに貼付（Ctrl+V）してください。
                </p>
                <div className="px-3 py-2 text-xs" style={{ background: 'var(--accent-pale)', borderRadius: '6px', color: 'var(--ink-2)' }}>
                  <strong>対応フォーマット:</strong>
                  <br />• 横型（1行目が日付、各セルに「迎 13:20 / 送 16:00」）
                  <br />• 縦型（児童名・日付・迎え・送り の列）
                  <br />• セル内改行がある Excel データもそのまま対応
                  <br />
                  <strong style={{ color: 'var(--red)' }}>※ デイロボ Web 画面から直接コピーするとタブが失われます。</strong>
                  その場合は「1児童モード」を利用してください。
                </div>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={'Excel からコピーしたデータを貼り付けてください...\n\n例:\n氏名\t1(水)\t2(木)\t3(金)\n川島舞桜\t迎 13:20 送 16:00\t...\n'}
                  rows={12}
                  className="w-full px-3 py-3 text-xs outline-none resize-y"
                  style={{
                    background: 'var(--bg)', color: 'var(--ink)',
                    border: '1px solid var(--rule)', borderRadius: '6px',
                    fontFamily: 'monospace', lineHeight: '1.6',
                  }}
                />
              </>
            ) : (
              <>
                <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  デイロボ Web 画面から <strong>1 児童の行だけ</strong>選択してコピーし、ここに貼付してください。
                </p>
                <div className="px-3 py-2 text-xs" style={{ background: 'var(--accent-pale)', borderRadius: '6px', color: 'var(--ink-2)' }}>
                  <strong>入力ルール（30 日分）:</strong>
                  <br />• 1 日分 = <code>迎HH:MM\n送HH:MM</code>（2 行）or <code>定・休 / 追・休 / 欠</code>（1 行）
                  <br />• <strong>行けない日は空行で空ける</strong>ことで日付が正しく並びます
                  <br />• セル内の改行は維持したまま貼付すればOK（★ マーク等の飾りは自動で無視）
                </div>
                <label className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
                  対象児童
                  <select
                    value={singleChildName}
                    onChange={(e) => setSingleChildName(e.target.value)}
                    className="ml-2 px-2 py-1 text-xs outline-none rounded"
                    style={{ background: 'var(--white)', color: 'var(--ink)', border: '1px solid var(--rule)' }}
                  >
                    <option value="">-- 選択してください --</option>
                    {existingChildNames.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={'デイロボから 1 児童の行だけ選択してコピーしたものを貼付...\n\n例（30 日分縦に）:\n迎11:20\n送16:00\n迎11:20\n送16:00\n\n\n定・休\n...\n'}
                  rows={14}
                  className="w-full px-3 py-3 text-xs outline-none resize-y"
                  style={{
                    background: 'var(--bg)', color: 'var(--ink)',
                    border: '1px solid var(--rule)', borderRadius: '6px',
                    fontFamily: 'monospace', lineHeight: '1.6',
                  }}
                />
              </>
            )}

            {error && (
              <p className="text-xs font-medium px-3 py-2 whitespace-pre-line"
                style={{ color: 'var(--red)', background: 'var(--red-pale)', borderRadius: '4px' }}>
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { handleReset(); onClose(); }}>キャンセル</Button>
              <Button variant="primary" onClick={handleParse} disabled={!rawText.trim()}>プレビュー</Button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <ExcelGridPreview
            parsed={parsed}
            onParsedChange={setParsed}
            childNames={childNames}
            unknownChildNames={unknownChildNames}
            onBack={() => setStep('paste')}
            onConfirm={handleConfirm}
            onRequestRegister={() => setRegisterOpen(true)}
            existingEntries={existingEntries}
            childNameToId={childNameToId}
          />
        )}
      </div>

      {registerOpen && (
        <UnknownChildrenRegisterDialog
          names={unknownChildNames}
          tenantId={tenantId}
          facilityId={facilityId}
          onClose={() => setRegisterOpen(false)}
          onDone={async () => {
            setRegisterOpen(false);
            if (onChildrenRegistered) await onChildrenRegistered();
          }}
        />
      )}
    </Modal>
  );
}

/* ================================================================
 * Excel風グリッドプレビュー（児童×日付）
 * ================================================================ */

function ExcelGridPreview({
  parsed,
  onParsedChange,
  childNames,
  unknownChildNames,
  onBack,
  onConfirm,
  onRequestRegister,
  existingEntries = [],
  childNameToId,
}: {
  parsed: ParsedScheduleEntry[];
  onParsedChange: (entries: ParsedScheduleEntry[]) => void;
  childNames: string[];
  unknownChildNames: string[];
  onBack: () => void;
  onConfirm: () => void;
  onRequestRegister: () => void;
  existingEntries?: ExistingEntrySummary[];
  childNameToId?: Map<string, string>;
}) {
  const [editingCell, setEditingCell] = useState<{ child: string; date: string } | null>(null);

  const dates = [...new Set(parsed.map((e) => e.date))].sort();
  const cellMap = new Map<string, ParsedScheduleEntry>();
  parsed.forEach((e) => cellMap.set(`${e.child_name}_${e.date}`, e));

  /* 完全上書き: 貼り付けに含まれる (child_id, date) 以外の当月既存利用は削除される。
     その件数だけを警告として表示する（差分の細分類は廃止）。 */
  const importedKeys = new Set<string>();
  for (const entry of parsed) {
    const childId = childNameToId?.get(entry.child_name);
    if (childId) importedKeys.add(`${childId}_${entry.date}`);
  }
  const removeCount = existingEntries.filter(
    (e) => !importedKeys.has(`${e.child_id}_${e.date}`),
  ).length;

  const handleCellUpdate = (
    childName: string,
    date: string,
    field: 'pickup_time' | 'dropoff_time',
    value: string
  ) => {
    const key = `${childName}_${date}`;
    const existing = cellMap.get(key);
    if (existing) {
      onParsedChange(
        parsed.map((e) =>
          e.child_name === childName && e.date === date
            ? { ...e, [field]: value || null }
            : e
        )
      );
    }
  };

  const handleDeleteChild = (childName: string) => {
    onParsedChange(parsed.filter((e) => e.child_name !== childName));
  };

  const formatDay = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.getDate();
    const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return { day, dow, isWeekend: d.getDay() === 0 || d.getDay() === 6 };
  };

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="success">{parsed.length}件</Badge>
        <Badge variant="info">{childNames.length}名</Badge>
        <span className="text-xs" style={{ color: 'var(--ink-3)' }}>セルをクリックして時間を修正できます</span>
      </div>

      {existingEntries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 text-xs"
          style={{ background: removeCount > 0 ? 'var(--gold-pale)' : 'var(--accent-pale)', borderRadius: '6px', color: 'var(--ink-2)' }}>
          <strong style={{ color: 'var(--ink)' }}>上書き:</strong>
          <span>この内容で当月の利用表を置き換えます。</span>
          {removeCount > 0 ? (
            <span className="px-2 py-0.5 rounded font-semibold" style={{ background: '#fecaca', color: '#7f1d1d' }}>
              🔴 貼り付けに無い既存 {removeCount} 件を削除（紐づく送迎も連動削除）
            </span>
          ) : (
            <span style={{ color: 'var(--ink-3)' }}>削除される既存利用はありません</span>
          )}
        </div>
      )}

      {unknownChildNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2"
          style={{ background: 'var(--gold-pale)', border: '1px solid rgba(184,134,11,0.25)', borderRadius: '6px' }}>
          <span className="text-sm" style={{ color: 'var(--gold)' }}>
            ⚠ 未登録の児童が <strong>{unknownChildNames.length}名</strong> います:
          </span>
          <span className="text-xs flex flex-wrap gap-1" style={{ color: 'var(--ink-2)' }}>
            {unknownChildNames.slice(0, 5).map((n) => (
              <span key={n} className="px-1.5 py-0.5 rounded" style={{ background: 'var(--white)' }}>
                {n}
              </span>
            ))}
            {unknownChildNames.length > 5 && <span>…他 {unknownChildNames.length - 5}名</span>}
          </span>
          <Button variant="primary" onClick={onRequestRegister}>一括登録する</Button>
        </div>
      )}

      <div className="overflow-auto" style={{ maxHeight: '450px', borderRadius: '6px', border: '1px solid var(--rule)' }}>
        <table className="border-collapse" style={{ fontSize: '0.75rem', minWidth: `${dates.length * 72 + 120}px` }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 px-2 py-1.5 text-left font-semibold"
                style={{ background: 'var(--ink)', color: '#fff', borderRight: '2px solid rgba(255,255,255,0.2)', minWidth: '100px' }}>
                氏名
              </th>
              {dates.map((date) => {
                const { day, dow, isWeekend } = formatDay(date);
                return (
                  <th key={date} className="px-1 py-1.5 text-center font-semibold whitespace-nowrap"
                    style={{
                      background: 'var(--ink)', color: isWeekend ? 'rgba(255,255,255,0.5)' : '#fff',
                      borderRight: '1px solid rgba(255,255,255,0.1)', minWidth: '64px',
                    }}>
                    <div style={{ fontSize: '0.65rem', opacity: 0.7 }}>{dow}</div>
                    <div>{day}</div>
                  </th>
                );
              })}
              <th className="px-2 py-1.5 text-center font-semibold"
                style={{ background: 'var(--ink)', color: '#fff', minWidth: '36px' }}>削除</th>
            </tr>
          </thead>
          <tbody>
            {childNames.map((childName) => {
              const { name, gradeLabel } = parseChildName(childName);
              return (
                <tr key={childName}>
                  <td className="sticky left-0 z-10 px-2 py-1 font-medium whitespace-nowrap"
                    style={{
                      background: 'var(--white)', borderBottom: '1px solid var(--rule)',
                      borderRight: '2px solid var(--rule-strong)', color: 'var(--ink)',
                    }}>
                    <div className="flex items-center gap-1.5">
                      <span>{name}</span>
                      {gradeLabel && (
                        <span className="text-xs px-1 rounded"
                          style={{ background: 'var(--accent-pale)', color: 'var(--accent)', fontSize: '0.6rem' }}>
                          {gradeLabel}
                        </span>
                      )}
                    </div>
                  </td>
                  {dates.map((date) => {
                    const entry = cellMap.get(`${childName}_${date}`);
                    const isEditing = editingCell?.child === childName && editingCell?.date === date;
                    const { isWeekend } = formatDay(date);

                    return (
                      <td key={date}
                        className="px-0.5 py-0.5 text-center cursor-pointer transition-colors hover:bg-[var(--accent-pale)]"
                        style={{
                          borderBottom: '1px solid var(--rule)', borderRight: '1px solid var(--rule)',
                          background: isWeekend ? 'rgba(0,0,0,0.02)' : 'transparent',
                          position: 'relative',
                        }}
                        onClick={() => setEditingCell(entry ? { child: childName, date } : null)}>
                        {entry?.area_label ? (
                          <span className="text-xs" style={{ color: 'var(--accent)' }}>{entry.area_label}</span>
                        ) : entry ? (
                          <div className="flex flex-col leading-tight">
                            {entry.pickup_time && (
                              <span style={{ color: 'var(--accent)', fontSize: '0.68rem' }}>迎 {entry.pickup_time}</span>
                            )}
                            {entry.dropoff_time && (
                              <span style={{ color: 'var(--green)', fontSize: '0.68rem' }}>送 {entry.dropoff_time}</span>
                            )}
                          </div>
                        ) : null}

                        {isEditing && entry && (
                          <div className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1 p-2 flex flex-col gap-1.5 w-36"
                            style={{
                              background: 'var(--white)', borderRadius: '6px',
                              boxShadow: '0 8px 24px rgba(0,0,0,0.15)', border: '1px solid var(--rule)',
                            }}
                            onClick={(e) => e.stopPropagation()}>
                            <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                              {childName} {formatDay(date).day}日
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs w-6" style={{ color: 'var(--accent)' }}>迎</span>
                              <input type="time" value={entry.pickup_time || ''}
                                onChange={(e) => handleCellUpdate(childName, date, 'pickup_time', e.target.value)}
                                className="flex-1 px-1 py-0.5 text-xs outline-none"
                                style={{ border: '1px solid var(--rule)', borderRadius: '3px', color: 'var(--ink)' }} />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs w-6" style={{ color: 'var(--green)' }}>送</span>
                              <input type="time" value={entry.dropoff_time || ''}
                                onChange={(e) => handleCellUpdate(childName, date, 'dropoff_time', e.target.value)}
                                className="flex-1 px-1 py-0.5 text-xs outline-none"
                                style={{ border: '1px solid var(--rule)', borderRadius: '3px', color: 'var(--ink)' }} />
                            </div>
                            <button onClick={() => setEditingCell(null)}
                              className="text-xs font-semibold py-0.5 rounded"
                              style={{ background: 'var(--accent)', color: '#fff', borderRadius: '3px' }}>OK</button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-center" style={{ borderBottom: '1px solid var(--rule)' }}>
                    <button onClick={() => handleDeleteChild(childName)}
                      className="text-xs hover:opacity-70" style={{ color: 'var(--red)' }}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack}>戻る</Button>
        <Button variant="primary" onClick={onConfirm}>この内容で登録する（{parsed.length}件）</Button>
      </div>
    </>
  );
}

/* ================================================================
 * Excel TSV パーサー（shift-puzzle 完全移植）
 * ================================================================ */

type ParseResult = {
  entries: ParsedScheduleEntry[];
  weekdayMismatch: string | null;
};

function parseExcelClipboard(raw: string, year: number, month: number): ParseResult {
  const normalized = raw.normalize('NFKC');
  const rows = parseTsvWithQuotes(normalized);
  if (rows.length < 2) return { entries: [], weekdayMismatch: null };

  const headerRow = rows[0];
  const dateColumns: { colIndex: number; dateStr: string; headerDow: string | null }[] = [];

  for (let i = 1; i < headerRow.length; i++) {
    const parsed = parseDateFromHeader(headerRow[i], year, month);
    if (parsed) {
      dateColumns.push({ colIndex: i, dateStr: parsed.dateStr, headerDow: parsed.headerDow });
    }
  }

  if (dateColumns.length === 0) {
    return parseVerticalFormat(rows, year, month);
  }

  const mismatch = detectWeekdayMismatch(dateColumns, year, month);
  if (mismatch) return { entries: [], weekdayMismatch: mismatch };

  const entries: ParsedScheduleEntry[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const childName = cleanChildName(row[0]);
    if (!childName || childName === '利用数' || childName === '利用人数') continue;

    for (const dc of dateColumns) {
      const cellValue = row[dc.colIndex] || '';
      if (!cellValue.trim()) continue;

      const { pickup, dropoff, pickup_method, dropoff_method, note } = parseCellValue(cellValue);

      if (pickup || dropoff || note) {
        entries.push({
          child_name: childName,
          date: dc.dateStr,
          pickup_time: pickup,
          dropoff_time: dropoff,
          pickup_method,
          dropoff_method,
          area_label: note,
        });
      }
    }
  }

  return { entries, weekdayMismatch: null };
}

function detectWeekdayMismatch(
  dateColumns: { dateStr: string; headerDow: string | null }[],
  year: number,
  month: number
): string | null {
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const samples = dateColumns.filter((c) => c.headerDow);
  if (samples.length === 0) return null;

  const mismatches = samples.filter((c) => {
    const d = new Date(c.dateStr);
    return DOW[d.getDay()] !== c.headerDow;
  });
  if (mismatches.length === 0) return null;

  let inferred: { year: number; month: number } | null = null;
  for (let offset = -6; offset <= 6; offset++) {
    if (offset === 0) continue;
    const base = new Date(year, month - 1 + offset, 1);
    const candY = base.getFullYear();
    const candM = base.getMonth() + 1;
    const allMatch = samples.every((s) => {
      const sDay = parseInt(s.dateStr.slice(-2), 10);
      const candDate = new Date(candY, candM - 1, sDay);
      if (candDate.getMonth() + 1 !== candM) return false;
      return DOW[candDate.getDay()] === s.headerDow;
    });
    if (allMatch) {
      inferred = { year: candY, month: candM };
      break;
    }
  }

  const current = `${year}年${month}月`;
  if (inferred) {
    return `貼り付けたデータは ${inferred.year}年${inferred.month}月 のものです。現在は ${current} の画面を開いています。${inferred.year}年${inferred.month}月の画面で貼り付け直してください。`;
  }
  return `貼り付けたデータのヘッダー曜日と ${current} の曜日が一致しません（例: ${mismatches[0].dateStr} はヘッダー「${mismatches[0].headerDow}」だが実際は「${DOW[new Date(mismatches[0].dateStr).getDay()]}」）。正しい月の画面で貼り付けてください。`;
}

function parseTsvWithQuotes(raw: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < raw.length && raw[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      currentField += ch;
      i++;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === '\t') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentField);
        currentField = '';
        if (ch === '\r' && i + 1 < raw.length && raw[i + 1] === '\n') i++;
        if (currentRow.some((f) => f.trim())) rows.push(currentRow);
        currentRow = [];
        i++;
      } else {
        currentField += ch;
        i++;
      }
    }
  }

  currentRow.push(currentField);
  if (currentRow.some((f) => f.trim())) rows.push(currentRow);

  return rows;
}

function parseCellValue(cell: string): {
  pickup: string | null;
  dropoff: string | null;
  pickup_method: 'pickup' | 'self';
  dropoff_method: 'dropoff' | 'self';
  note: string | null;
} {
  const text = cell.trim();
  const defaultMethods = { pickup_method: 'pickup' as const, dropoff_method: 'dropoff' as const };

  if (/[定追][\s・‧][休]/.test(text) || text === '定休' || text === '追休') {
    return { pickup: null, dropoff: null, ...defaultMethods, note: text.replace(/\s+/g, '') };
  }

  const times: { time: string; type: 'pickup' | 'dropoff' | 'unknown' }[] = [];
  const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const timeMatch = line.match(/(\d{1,2}):(\d{2})/);
    if (!timeMatch) continue;
    const time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    if (line.includes('迎')) times.push({ time, type: 'pickup' });
    else if (line.includes('送')) times.push({ time, type: 'dropoff' });
    else times.push({ time, type: 'unknown' });
  }

  if (times.length === 0) {
    return { pickup: null, dropoff: null, ...defaultMethods, note: null };
  }

  let pickup: string | null = null;
  let dropoff: string | null = null;
  let pickup_method: 'pickup' | 'self' = 'pickup';
  let dropoff_method: 'dropoff' | 'self' = 'dropoff';

  const pickupEntry = times.find((t) => t.type === 'pickup');
  const dropoffEntry = times.find((t) => t.type === 'dropoff');

  if (pickupEntry) {
    pickup = pickupEntry.time;
    pickup_method = 'pickup';
  }
  if (dropoffEntry) {
    dropoff = dropoffEntry.time;
    dropoff_method = 'dropoff';
  }

  if (!pickup && !dropoff && times.length >= 2) {
    pickup = times[0].time;
    dropoff = times[1].time;
    pickup_method = 'self';
    dropoff_method = 'self';
  } else if (!pickup && !dropoff && times.length === 1) {
    pickup = times[0].time;
    pickup_method = 'self';
  }

  const unknowns = times.filter((t) => t.type === 'unknown');
  for (const u of unknowns) {
    if (!pickup && u.time !== dropoff) { pickup = u.time; pickup_method = 'self'; continue; }
    if (!dropoff && u.time !== pickup) { dropoff = u.time; dropoff_method = 'self'; }
  }

  return { pickup, dropoff, pickup_method, dropoff_method, note: null };
}

function parseDateFromHeader(
  header: string,
  year: number,
  month: number
): { dateStr: string; headerDow: string | null } | null {
  if (!header || !header.trim()) return null;
  const cleaned = header.trim();

  const match = cleaned.match(/(\d{1,2})\s*[\(（]\s*([日月火水木金土])/);
  if (match) {
    const d = parseInt(match[1], 10);
    if (d >= 1 && d <= 31) {
      return { dateStr: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, headerDow: match[2] };
    }
  }

  const noDow = cleaned.match(/(\d{1,2})\s*[\(（]/);
  if (noDow) {
    const d = parseInt(noDow[1], 10);
    if (d >= 1 && d <= 31) {
      return { dateStr: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, headerDow: null };
    }
  }

  const numMatch = cleaned.match(/^[^\d]*(\d{1,2})[^\d]*$/);
  if (numMatch) {
    const d = parseInt(numMatch[1], 10);
    if (d >= 1 && d <= 31) {
      return { dateStr: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, headerDow: null };
    }
  }

  return null;
}

function parseVerticalFormat(rows: string[][], year: number, month: number): ParseResult {
  const entries: ParsedScheduleEntry[] = [];

  for (const row of rows) {
    if (row.length < 2) continue;
    const childName = cleanChildName(row[0]);
    if (!childName || childName === '氏名' || childName === '児童名') continue;

    const dateStr = parseDate(row[1], year, month);
    if (!dateStr) continue;

    const pickupTime = parseTimeStr(row[2]);
    const dropoffTime = parseTimeStr(row[3]);

    if (pickupTime || dropoffTime) {
      entries.push({
        child_name: childName,
        date: dateStr,
        pickup_time: pickupTime,
        dropoff_time: dropoffTime,
        pickup_method: 'pickup',
        dropoff_method: 'dropoff',
        area_label: row[4]?.trim() || null,
      });
    }
  }

  return { entries, weekdayMismatch: null };
}

function cleanChildName(raw: string | undefined): string {
  if (!raw) return '';
  const stripped = raw.trim().replace(/[✓✅☑]/g, '').replace(/[\n\r]/g, ' ').trim();
  if (!stripped) return '';
  return parseChildName(stripped).name;
}

function parseDate(str: string | undefined, year: number, month: number): string | null {
  if (!str) return null;
  const cleaned = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    return `${year}-${String(parseInt(slashMatch[1])).padStart(2, '0')}-${String(parseInt(slashMatch[2])).padStart(2, '0')}`;
  }
  const dayOnly = cleaned.match(/^(\d{1,2})$/);
  if (dayOnly) {
    const d = parseInt(dayOnly[1], 10);
    if (d >= 1 && d <= 31) return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

function parseSingleChildVertical(
  raw: string,
  year: number,
  month: number,
  childName: string,
): { entries: ParsedScheduleEntry[]; error: string | null } {
  const daysInMonth = new Date(year, month, 0).getDate();
  const normalized = raw.normalize('NFKC').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  let end = lines.length;
  while (end > start && !lines[end - 1].trim()) end--;
  const trimmed = lines.slice(start, end);

  const entries: ParsedScheduleEntry[] = [];
  let dayIdx = 1;
  let i = 0;

  const yyyymm = `${year}-${String(month).padStart(2, '0')}`;
  const dateStr = (d: number) => `${yyyymm}-${String(d).padStart(2, '0')}`;

  const isTimeLine = (s: string) =>
    /^(★)?迎?\d{1,2}:\d{2}$/.test(s) || /^\d{1,2}:\d{2}$/.test(s);
  const isDropoffLine = (s: string) => /^送?\d{1,2}:\d{2}$/.test(s);

  while (i < trimmed.length && dayIdx <= daysInMonth) {
    const line = trimmed[i].trim();

    if (line === '') {
      dayIdx++;
      i++;
      continue;
    }

    if (line === '定・休' || line === '追・休' || line === '欠') {
      dayIdx++;
      i++;
      continue;
    }

    if (isTimeLine(line)) {
      const nxt = i + 1 < trimmed.length ? trimmed[i + 1].trim() : '';
      const isPair = nxt !== '' && isDropoffLine(nxt);
      const cellValue = isPair ? `${line}\n${nxt}` : line;
      const parsed = parseCellValue(cellValue);
      if (parsed.pickup || parsed.dropoff || parsed.note) {
        entries.push({
          child_name: childName,
          date: dateStr(dayIdx),
          pickup_time: parsed.pickup,
          dropoff_time: parsed.dropoff,
          pickup_method: parsed.pickup_method,
          dropoff_method: parsed.dropoff_method,
          area_label: parsed.note,
        });
      }
      dayIdx++;
      i += isPair ? 2 : 1;
      continue;
    }

    return {
      entries: [],
      error: `解析できない行があります（${dayIdx} 日目付近）: "${line.slice(0, 30)}"`,
    };
  }

  if (i < trimmed.length) {
    return {
      entries: [],
      error: `${year}年${month}月は ${daysInMonth} 日までですが、それ以上の入力があります。30 日分だけ貼り付けてください。`,
    };
  }

  return { entries, error: null };
}

function parseTimeStr(str: string | undefined): string | null {
  if (!str) return null;
  const match = str.trim().match(/(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  return null;
}

/* ================================================================
 * 未登録児童の一括登録ダイアログ
 * - shift-puzzle: fetch('/api/children')
 * - deaf-ic: 直接 supabase で children テーブルに insert（facility_id 必要）
 * ================================================================ */

type UnknownRow = {
  name: string;
  grade_type: GradeType;
  home_address: string;
};

const GRADE_OPTIONS: { value: GradeType; label: string }[] = [
  { value: 'preschool', label: '未就学' },
  { value: 'nursery_3', label: '年少' },
  { value: 'nursery_4', label: '年中' },
  { value: 'nursery_5', label: '年長' },
  { value: 'elementary_1', label: '小1' },
  { value: 'elementary_2', label: '小2' },
  { value: 'elementary_3', label: '小3' },
  { value: 'elementary_4', label: '小4' },
  { value: 'elementary_5', label: '小5' },
  { value: 'elementary_6', label: '小6' },
  { value: 'junior_high_1', label: '中1' },
  { value: 'junior_high_2', label: '中2' },
  { value: 'junior_high_3', label: '中3' },
  { value: 'high_1', label: '高1' },
  { value: 'high_2', label: '高2' },
  { value: 'high_3', label: '高3' },
];

function UnknownChildrenRegisterDialog({
  names,
  tenantId,
  facilityId,
  onClose,
  onDone,
}: {
  names: string[];
  tenantId: string;
  facilityId: string;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<UnknownRow[]>(() =>
    names.map((n) => {
      const parsed = parseChildName(n);
      return {
        name: parsed.name || n,
        grade_type: parsed.grade ?? 'elementary_1',
        home_address: '',
      };
    })
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const updateRow = <K extends keyof UnknownRow>(idx: number, field: K, value: UnknownRow[K]) => {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const removeRow = (idx: number) => setRows((rs) => rs.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (rows.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    let okCount = 0;
    let firstError = '';

    // 末尾の display_order 取得
    const { data: maxRow } = await supabase
      .from('children')
      .select('display_order')
      .eq('tenant_id', tenantId)
      .eq('facility_id', facilityId)
      .order('display_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    let nextOrder = ((maxRow as { display_order?: number | null } | null)?.display_order ?? -1) + 1;

    for (const r of rows) {
      if (!r.name.trim()) continue;
      try {
        const { error: insErr } = await supabase
          .from('children')
          .insert({
            tenant_id: tenantId,
            facility_id: facilityId,
            name: r.name.trim(),
            grade_type: r.grade_type,
            home_address: r.home_address.trim() || null,
            is_active: true,
            display_order: nextOrder++,
          });
        if (insErr) {
          if (!firstError) firstError = insErr.message;
        } else {
          okCount++;
        }
      } catch (e) {
        if (!firstError) firstError = e instanceof Error ? e.message : '登録に失敗';
      }
    }
    setBusy(false);
    if (firstError && okCount === 0) {
      setError(firstError);
      return;
    }
    await onDone();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-auto rounded-lg p-5"
        style={{
          background: '#ffffff',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
          border: '1px solid var(--rule)',
        }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
            未登録児童の一括登録 <span className="text-sm ml-2" style={{ color: 'var(--ink-3)' }}>{rows.length}名</span>
          </h3>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--ink-3)' }} aria-label="閉じる">×</button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--ink-3)' }}>
          Excelの氏名から学年を推定しています。必要に応じて修正してください。自宅住所は任意です（後から児童管理で設定可）。
        </p>

        {error && (
          <div className="mb-3 px-3 py-2 text-xs rounded" style={{ background: 'var(--red-pale)', color: 'var(--red)' }}>
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2 mb-4">
          {rows.map((r, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center p-2 rounded"
              style={{ background: 'var(--bg)', border: '1px solid var(--rule)' }}>
              <input type="text" value={r.name}
                onChange={(e) => updateRow(idx, 'name', e.target.value)}
                className="col-span-3 text-sm outline-none px-2 py-1.5 rounded"
                style={{ background: 'var(--white)', color: 'var(--ink)', border: '1px solid var(--rule)' }}
                placeholder="氏名" />
              <select value={r.grade_type}
                onChange={(e) => updateRow(idx, 'grade_type', e.target.value as GradeType)}
                className="col-span-2 text-sm outline-none px-2 py-1.5 rounded"
                style={{ background: 'var(--white)', color: 'var(--ink)', border: '1px solid var(--rule)' }}>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
              <input type="text" value={r.home_address}
                onChange={(e) => updateRow(idx, 'home_address', e.target.value)}
                className="col-span-6 text-xs outline-none px-2 py-1.5 rounded"
                style={{ background: 'var(--white)', color: 'var(--ink)', border: '1px solid var(--rule)' }}
                placeholder="自宅住所（任意）" />
              <button onClick={() => removeRow(idx)} className="col-span-1 text-xs"
                style={{ color: 'var(--red)' }} title="除外">✕</button>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={busy || rows.length === 0}>
            {busy ? '登録中...' : `${rows.length}名を一括登録`}
          </Button>
        </div>
      </div>
    </div>
  );
}
