'use client';

import type { ChildRow, ParsedScheduleEntry, AreaLabel } from '@/lib/types';
import { mergeAreas } from '@/lib/shift-logic/resolveTransportSpec';

/**
 * PDF解析結果の確認テーブル（shift-puzzle 忠実移植）
 * - 解析結果を一覧表示
 * - 各行を編集可能（時間の修正、行の削除、迎/送マークの切替）
 */

type PdfConfirmTableProps = {
  entries: ParsedScheduleEntry[];
  onEntriesChange: (entries: ParsedScheduleEntry[]) => void;
  childList: ChildRow[];
  pickupAreas?: AreaLabel[];
  dropoffAreas?: AreaLabel[];
};

export default function PdfConfirmTable({
  entries,
  onEntriesChange,
  childList,
  pickupAreas = [],
  dropoffAreas = [],
}: PdfConfirmTableProps) {
  const childNames = [...new Set(entries.map((e) => e.child_name))];
  const childByName = new Map(childList.map((c) => [c.name, c]));

  const handleDelete = (index: number) => {
    const updated = entries.filter((_, i) => i !== index);
    onEntriesChange(updated);
  };

  const handleTimeChange = (
    index: number,
    field: 'pickup_time' | 'dropoff_time',
    value: string
  ) => {
    const updated = entries.map((entry, i) =>
      i === index ? { ...entry, [field]: value || null } : entry
    );
    onEntriesChange(updated);
  };

  const handleMarkChange = (
    index: number,
    field: 'pickup_mark' | 'dropoff_mark',
    value: string,
  ) => {
    const updated = entries.map((entry, i) =>
      i === index ? { ...entry, [field]: value === '' ? null : value } : entry
    );
    onEntriesChange(updated);
  };

  const unlinkedCount = entries.filter((e) => !e.pickup_mark && !e.dropoff_mark).length;

  return (
    <div
      className="overflow-auto"
      style={{ maxHeight: '400px', borderRadius: '6px', border: '1px solid var(--rule)' }}
    >
      <table className="w-full border-collapse" style={{ fontSize: '0.8rem' }}>
        <thead>
          <tr>
            {['児童名', '日付', '迎え', '送り', '迎マーク', '送マーク', '削除'].map((h, i) => (
              <th
                key={h}
                className="sticky top-0 px-3 py-2 font-semibold"
                style={{
                  background: 'var(--ink)',
                  color: '#fff',
                  borderBottom: '1px solid var(--rule)',
                  textAlign: i >= 2 ? 'center' : 'left',
                  width: h === '削除' ? '40px' : undefined,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const isFirstOfChild =
              index === 0 || entries[index - 1].child_name !== entry.child_name;
            const child = childByName.get(entry.child_name);
            const mergedPickupAreas = mergeAreas(pickupAreas, child?.custom_pickup_areas);
            const mergedDropoffAreas = mergeAreas(dropoffAreas, child?.custom_dropoff_areas);
            const childPickupIds = new Set(child?.pickup_area_labels ?? []);
            const childDropoffIds = new Set(child?.dropoff_area_labels ?? []);
            const pickupOptions: AreaLabel[] = mergedPickupAreas.filter((a) => childPickupIds.has(a.id));
            const dropoffOptions: AreaLabel[] = mergedDropoffAreas.filter((a) => childDropoffIds.has(a.id));
            const hasAnyPickupSource = pickupAreas.length > 0 || (child?.custom_pickup_areas?.length ?? 0) > 0;
            const hasAnyDropoffSource = dropoffAreas.length > 0 || (child?.custom_dropoff_areas?.length ?? 0) > 0;
            const hasAnyMark = Boolean(entry.pickup_mark) || Boolean(entry.dropoff_mark);
            const rowMark = hasAnyMark ? '🔗' : '⚠';
            const markColor = hasAnyMark ? 'var(--green)' : 'var(--gold)';
            return (
              <tr
                key={`${entry.child_name}_${entry.date}_${index}`}
                className="transition-colors hover:bg-[var(--accent-pale)]"
              >
                <td
                  className="px-3 py-1.5 font-medium"
                  style={{
                    borderBottom: '1px solid var(--rule)',
                    color: 'var(--ink)',
                    background: isFirstOfChild ? 'var(--bg)' : 'transparent',
                  }}
                >
                  {isFirstOfChild ? (
                    <span className="inline-flex items-center gap-1">
                      <span style={{ color: markColor }} title={hasAnyMark ? 'マークで解決済' : 'マーク未設定'}>{rowMark}</span>
                      {entry.child_name}
                      {!child && (
                        <span className="text-[10px]" style={{ color: 'var(--red)' }}>（未登録）</span>
                      )}
                    </span>
                  ) : (
                    ''
                  )}
                </td>
                <td className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--rule)', color: 'var(--ink-2)' }}>
                  {entry.date}
                </td>
                <td className="px-1 py-1.5 text-center" style={{ borderBottom: '1px solid var(--rule)' }}>
                  <input
                    type="time"
                    value={entry.pickup_time || ''}
                    onChange={(e) => handleTimeChange(index, 'pickup_time', e.target.value)}
                    className="w-20 px-1 py-0.5 text-center text-xs outline-none"
                    style={{
                      border: '1px solid var(--rule)',
                      borderRadius: '4px',
                      color: 'var(--accent)',
                    }}
                  />
                </td>
                <td className="px-1 py-1.5 text-center" style={{ borderBottom: '1px solid var(--rule)' }}>
                  <input
                    type="time"
                    value={entry.dropoff_time || ''}
                    onChange={(e) => handleTimeChange(index, 'dropoff_time', e.target.value)}
                    className="w-20 px-1 py-0.5 text-center text-xs outline-none"
                    style={{
                      border: '1px solid var(--rule)',
                      borderRadius: '4px',
                      color: 'var(--green)',
                    }}
                  />
                </td>
                <td className="px-2 py-1.5" style={{ borderBottom: '1px solid var(--rule)' }}>
                  {pickupOptions.length === 0 ? (
                    <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                      {!hasAnyPickupSource ? '（事業所未設定）' : '（児童に未登録）'}
                    </span>
                  ) : (
                    <select
                      value={entry.pickup_mark ?? ''}
                      onChange={(e) => handleMarkChange(index, 'pickup_mark', e.target.value)}
                      className="w-full px-1 py-1 text-xs outline-none"
                      style={{
                        border: '1px solid var(--rule)',
                        borderRadius: '4px',
                        background: entry.pickup_mark ? 'var(--white)' : 'var(--bg)',
                        color: 'var(--ink)',
                      }}
                    >
                      <option value="">—</option>
                      {pickupOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-1.5" style={{ borderBottom: '1px solid var(--rule)' }}>
                  {dropoffOptions.length === 0 ? (
                    <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                      {!hasAnyDropoffSource ? '（事業所未設定）' : '（児童に未登録）'}
                    </span>
                  ) : (
                    <select
                      value={entry.dropoff_mark ?? ''}
                      onChange={(e) => handleMarkChange(index, 'dropoff_mark', e.target.value)}
                      className="w-full px-1 py-1 text-xs outline-none"
                      style={{
                        border: '1px solid var(--rule)',
                        borderRadius: '4px',
                        background: entry.dropoff_mark ? 'var(--white)' : 'var(--bg)',
                        color: 'var(--ink)',
                      }}
                    >
                      <option value="">—</option>
                      {dropoffOptions.map((a) => (
                        <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-1 py-1.5 text-center" style={{ borderBottom: '1px solid var(--rule)' }}>
                  <button
                    onClick={() => handleDelete(index)}
                    className="text-xs hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--red)' }}
                    title="この行を削除"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div
        className="px-3 py-2 text-xs font-medium flex gap-4 flex-wrap items-center"
        style={{ background: 'var(--bg)', borderTop: '1px solid var(--rule)', color: 'var(--ink-2)' }}
      >
        <span>児童数: {childNames.length}名</span>
        <span>レコード数: {entries.length}件</span>
        {unlinkedCount > 0 && (
          <span style={{ color: 'var(--gold)' }}>
            ⚠ マーク未解決: {unlinkedCount}件（このままでも登録できますが /transport で場所が空欄になります）
          </span>
        )}
      </div>
    </div>
  );
}
