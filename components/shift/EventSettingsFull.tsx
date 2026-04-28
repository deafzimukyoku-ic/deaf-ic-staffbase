'use client';

/**
 * イベント設定（Phase 66-B / migration 127）
 *
 * - 月切替（前月 / 当月 / 次月）+ 月単位リスト
 * - 各行: 日付 / 名前 / 金額（円）/ 削除
 * - 「+ 追加」で空行追加 → 入力 → 「保存」で upsert
 * - 利用料金表の列ヘッダはこの月の events.name を昇順で並べる
 *
 * 設計判断:
 * - 月の events を一覧表示。 facility_id は selectedFacilityId に紐付け
 * - 並び順: date asc → display_order asc → created_at asc（display_order は手動 D&D 不要なので null 許容）
 * - 削除は確認モーダルなしで即実行（戻すには再追加）
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { format, getDaysInMonth } from 'date-fns';
import { ja } from 'date-fns/locale';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import Button from '@/components/shift-compat/Button';
import DatePopover from '@/components/shift/DatePopover';
import type { EventRow } from '@/lib/types';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
}

type EditableEvent = {
  /** 既存レコードなら uuid、新規行なら 'new-...' */
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  price: number;
  isNew?: boolean;
  /** 既存レコードに対する変更ありフラグ（保存対象判定）*/
  dirty?: boolean;
};

function defaultMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function EventSettingsFull({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [shiftFacilityId] = useShiftFacilityId();
  const facilityId =
    scope === 'manager' ? me?.facility_id ?? '' : shiftFacilityId ?? '';
  const [{ year, month }, setYM] = useState(() => defaultMonth());
  const [rows, setRows] = useState<EditableEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* 共通カスタムカレンダー (DatePopover) を使うための state。
     行ごとの日付ボタンクリック時に anchorRef を差し替えてから openRowId をセットして開く。 */
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const dateAnchorRef = useRef<HTMLButtonElement | null>(null);

  const monthFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthTo = `${year}-${String(month).padStart(2, '0')}-${String(getDaysInMonth(new Date(year, month - 1))).padStart(2, '0')}`;

  const loadMe = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (data) setMe(data as MeRow);
  }, [supabase]);

  const fetchEvents = useCallback(async () => {
    if (!me || !facilityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('events')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .eq('facility_id', facilityId)
        .gte('date', monthFrom)
        .lte('date', monthTo)
        .order('date', { ascending: true })
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (e) throw new Error(e.message);
      setRows(((data ?? []) as EventRow[]).map<EditableEvent>((r) => ({
        id: r.id,
        date: r.date,
        name: r.name,
        price: r.price,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, me, facilityId, monthFrom, monthTo]);

  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  const updateRow = (id: string, patch: Partial<EditableEvent>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: !r.isNew } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: genId(),
        date: `${year}-${String(month).padStart(2, '0')}-01`,
        name: '',
        price: 0,
        isNew: true,
      },
    ]);
  };

  const removeRow = async (row: EditableEvent) => {
    if (row.isNew) {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      return;
    }
    if (!confirm(`「${row.name}（${row.date}）」を削除しますか？`)) return;
    const { error: e } = await supabase.from('events').delete().eq('id', row.id);
    if (e) {
      setError(e.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  const handleSave = async () => {
    if (!me || !facilityId) return;
    setSaving(true);
    setError('');
    try {
      /* 新規行: insert / 既存 dirty 行: update */
      const newRows = rows.filter((r) => r.isNew && r.name.trim() !== '');
      const dirtyRows = rows.filter((r) => !r.isNew && r.dirty);

      if (newRows.length > 0) {
        const { error: e } = await supabase.from('events').insert(
          newRows.map((r) => ({
            tenant_id: me.tenant_id,
            facility_id: facilityId,
            date: r.date,
            name: r.name.trim(),
            price: Math.max(0, Math.floor(r.price)),
          })),
        );
        if (e) throw new Error(e.message);
      }
      for (const r of dirtyRows) {
        const { error: e } = await supabase
          .from('events')
          .update({ date: r.date, name: r.name.trim(), price: Math.max(0, Math.floor(r.price)) })
          .eq('id', r.id);
        if (e) throw new Error(e.message);
      }
      await fetchEvents();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  const dirtyCount = useMemo(
    () => rows.filter((r) => r.isNew || r.dirty).length,
    [rows],
  );

  function changeMonth(delta: number) {
    setYM(({ year: y, month: m }) => {
      const next = new Date(y, m - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  }

  return (
    <div className="flex flex-col gap-4 -m-6 lg:-m-8 p-6 lg:p-8 h-full overflow-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
          🎉 イベント設定
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => changeMonth(-1)}>‹ 前の月</Button>
          <div
            className="px-3 py-1.5 rounded font-bold"
            style={{ background: 'var(--white)', border: '1.5px solid var(--accent)', color: 'var(--ink)', minWidth: '110px', textAlign: 'center' }}
          >
            {year}年{month}月
          </div>
          <Button variant="secondary" onClick={() => changeMonth(1)}>次の月 ›</Button>
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
        利用料金表（月次）の列ヘッダになります。日付 / 名前 / 金額を入力して保存してください。
        参加した児童の判定は「利用料金表」ページで月締め時に手動チェックします。
      </p>

      {error && (
        <div className="px-4 py-2 rounded" style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {!facilityId ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>
          事業所が選択されていません。
        </div>
      ) : loading ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>読み込み中...</div>
      ) : (
        <>
          <div className="rounded border" style={{ borderColor: 'var(--rule)', background: 'var(--white)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--rule-strong)' }}>
                  <th className="text-left px-3 py-2 font-semibold" style={{ width: '160px' }}>日付</th>
                  <th className="text-left px-3 py-2 font-semibold">イベント名</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ width: '140px' }}>金額（円）</th>
                  <th className="text-center px-3 py-2 font-semibold" style={{ width: '80px' }}>削除</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center" style={{ color: 'var(--ink-3)' }}>
                      この月のイベントはまだありません
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    /* 日付ボタンの label: M/d（曜日）。値が空なら placeholder。 */
                    const dt = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? new Date(r.date) : null;
                    const dateLabel = dt ? format(dt, 'M月d日（E）', { locale: ja }) : '日付を選択';
                    return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--rule)' }}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            dateAnchorRef.current = e.currentTarget;
                            setOpenRowId(r.id);
                          }}
                          className="outline-none w-full px-2 py-1 rounded text-left transition-colors hover:bg-[var(--accent-pale)]"
                          style={{ background: 'var(--white)', border: '1px solid var(--rule)', color: 'var(--ink)' }}
                        >
                          {dateLabel}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={r.name}
                          onChange={(e) => updateRow(r.id, { name: e.target.value })}
                          placeholder="例) ピザづくり"
                          className="outline-none w-full px-2 py-1 rounded"
                          style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={r.price}
                          onChange={(e) => updateRow(r.id, { price: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                          className="outline-none w-full px-2 py-1 rounded text-right"
                          style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(r)}
                          className="text-xs font-semibold px-2 py-1 rounded"
                          style={{ color: 'var(--red)', background: 'transparent', border: '1px solid var(--red)' }}
                          aria-label={`${r.name} を削除`}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={addRow}>＋ イベント追加</Button>
            <div className="flex-1" />
            {dirtyCount > 0 && (
              <span className="text-xs" style={{ color: 'var(--gold, #d4a017)' }}>
                未保存 {dirtyCount} 件
              </span>
            )}
            <Button variant="primary" onClick={handleSave} disabled={saving || dirtyCount === 0}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </>
      )}

      {/* 共通カスタムカレンダー（DatePopover）。openRowId の行の anchor に紐付けて 1 つだけレンダ。 */}
      {openRowId && (
        <DatePopover
          open
          value={rows.find((r) => r.id === openRowId)?.date ?? `${year}-${String(month).padStart(2, '0')}-01`}
          onChange={(d) => {
            updateRow(openRowId, { date: d });
            setOpenRowId(null);
          }}
          onClose={() => setOpenRowId(null)}
          anchorRef={dateAnchorRef}
          allowMonthBrowse
        />
      )}
    </div>
  );
}
