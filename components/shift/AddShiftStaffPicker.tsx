'use client';

import { useEffect, useRef, useState } from 'react';
import type { StaffRow, ShiftAssignmentRow } from '@/lib/types';

/**
 * 送迎表の「シフト追加」モーダル用の職員ピッカー。
 * 元: diletto-shift-maker/src/components/transport/AddShiftStaffPicker.tsx を deaf-ic 化。
 *
 * 差分:
 * - StaffRow.is_active は deaf-ic に存在しないため、StaffRow（projection 済）はすべて active 扱い
 * - ShiftAssignmentRow.staff_id → employee_id
 *
 * - 通常: バッジなし
 * - 既にシフトあり → 青バッジ「分割追加」
 * - 公休/有給/休み → 金色 ⚠ バッジ
 */

type LeaveLabel = '公休' | '有給';

type PickerItem = {
  id: string;
  name: string;
  /** 既に当日 normal シフトが入っている（選ぶと分割追加になる） */
  hasShift: boolean;
  /** 当日「公休」または「有給」扱い。ない場合は null。
      Phase 59-fix: 'off'（ただの非出勤）はバッジ対象外 */
  leaveLabel: LeaveLabel | null;
};

function leaveLabelOf(a: ShiftAssignmentRow): LeaveLabel | null {
  if (a.assignment_type === 'public_holiday') return '公休';
  if (a.assignment_type === 'paid_leave') return '有給';
  return null;
}

export function buildPickerItems(
  staff: StaffRow[],
  shiftAssignments: ShiftAssignmentRow[],
  selectedDate: string,
): PickerItem[] {
  const items: PickerItem[] = staff.map((s) => {
    const dayAssignments = shiftAssignments.filter(
      (sa) => sa.employee_id === s.id && sa.date === selectedDate,
    );
    const hasShift = dayAssignments.some((sa) => sa.assignment_type === 'normal');
    const leaveA = dayAssignments.find((sa) => leaveLabelOf(sa) !== null);
    return {
      id: s.id,
      name: s.name,
      hasShift,
      leaveLabel: leaveA ? leaveLabelOf(leaveA) : null,
    };
  });
  /* 並び順: 通常 → 既にシフトあり → 休み扱い（下にまとめる） */
  const rank = (i: PickerItem) => (i.leaveLabel ? 2 : i.hasShift ? 1 : 0);
  items.sort((a, b) => rank(a) - rank(b));
  return items;
}

type Props = {
  value: string;
  onChange: (id: string) => void;
  items: PickerItem[];
  disabled?: boolean;
};

export default function AddShiftStaffPicker({ value, onChange, items, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const selected = items.find((i) => i.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full inline-flex items-center justify-between gap-3 outline-none transition-colors disabled:opacity-60"
        style={{
          padding: '10px 12px',
          minHeight: '44px',
          fontSize: '0.9rem',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--rule)'}`,
          borderRadius: '6px',
          background: 'var(--white)',
          color: selected ? 'var(--ink)' : 'var(--ink-3)',
          textAlign: 'left',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected ? selected.name : undefined}
      >
        <span className="flex-1 flex items-center gap-2 min-w-0">
          <span className="truncate font-medium">
            {selected ? selected.name : '選択してください'}
          </span>
          {selected && <BadgeFor item={selected} />}
        </span>
        <span
          aria-hidden
          style={{
            color: 'var(--ink-3)',
            fontSize: '0.75rem',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : undefined,
            flexShrink: 0,
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full overflow-auto"
          style={{
            maxHeight: '420px',
            background: 'var(--white)',
            border: '1px solid var(--rule)',
            borderRadius: '8px',
            boxShadow: '0 10px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.05)',
          }}
        >
          {items.length === 0 ? (
            <div className="px-3 py-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              職員がいません
            </div>
          ) : (
            items.map((item) => {
              const isSelected = item.id === value;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 transition-colors"
                  style={{
                    background: isSelected ? 'var(--accent-pale)' : 'transparent',
                    color: 'var(--ink)',
                    fontSize: '0.88rem',
                    textAlign: 'left',
                    borderTop: '1px solid var(--rule)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span className="flex-1 truncate font-medium">{item.name}</span>
                  <BadgeFor item={item} />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function BadgeFor({ item }: { item: PickerItem }) {
  if (item.leaveLabel) {
    /* シフト表 TYPE_CONFIG と色を揃える ─ 公休=accent(青), 有給=green */
    const isGreen = item.leaveLabel === '有給';
    const color = isGreen ? 'var(--green, #2f8f57)' : 'var(--accent)';
    const bg = isGreen ? 'var(--green-pale, rgba(47,143,87,0.10))' : 'var(--accent-pale)';
    return (
      <span
        className="shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded"
        style={{
          background: bg,
          color,
          border: `1px solid ${color}`,
        }}
      >
        ⚠ {item.leaveLabel}
      </span>
    );
  }
  if (item.hasShift) {
    /* 既にシフトあり = グレー系で控えめ表示（警告ではないので色を弱める） */
    return (
      <span
        className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded"
        style={{
          background: 'var(--bg)',
          color: 'var(--ink-2)',
          border: '1px solid var(--rule-strong)',
        }}
      >
        分割追加
      </span>
    );
  }
  return null;
}
