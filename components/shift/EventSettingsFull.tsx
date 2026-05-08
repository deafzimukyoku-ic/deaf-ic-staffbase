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
import { isAttended } from '@/lib/logic/attendance';

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
  /* イベントロード時の元の date を保持。保存時に「日付が変わったか」を検出するために使う
     （保存後に出席実績で billing_event_participations を再計算するため）。 */
  const originalDatesRef = useRef<Map<string, string>>(new Map());

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
      const list = (data ?? []) as EventRow[];
      originalDatesRef.current = new Map(list.map((r) => [r.id, r.date]));
      setRows(list.map<EditableEvent>((r) => ({
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

  /* 日付変更を出席実績ベースで billing_event_participations に反映。
     - 旧月: 該当 event_id の participation を削除（その月の料金表からイベントが消えるため）
     - 新月: 該当 event_id の participation を一旦削除 → 新日付の出席児童分を participated=true で insert
     - billing_summaries.event_total / total_amount も連動更新（料金表を開かなくても合計が整合）
     - 出席日数 / 利用負担額（copay）は再計算しない（イベント日付と無関係なため） */
  const syncParticipationsForDateChange = async (args: {
    eventId: string;
    oldDate: string;
    newDate: string;
    price: number;
  }) => {
    if (!me || !facilityId) return;
    const { eventId, oldDate, newDate, price } = args;

    const parseYM = (d: string): [number, number] => {
      const [y, m] = d.split('-').map(Number);
      return [y, m];
    };
    const [oldY, oldM] = parseYM(oldDate);
    const [newY, newM] = parseYM(newDate);
    const sameMonth = oldY === newY && oldM === newM;

    const targets: Array<{ y: number; m: number; recomputeDate: string | null }> = sameMonth
      ? [{ y: newY, m: newM, recomputeDate: newDate }]
      : [
          { y: oldY, m: oldM, recomputeDate: null },     // 旧月: 削除のみ
          { y: newY, m: newM, recomputeDate: newDate },  // 新月: 出席実績で再計算
        ];

    for (const { y, m, recomputeDate } of targets) {
      const { data: summaries, error: sumErr } = await supabase
        .from('billing_summaries')
        .select('id, child_id, copay_amount, snack_fee, kumon_fee')
        .eq('tenant_id', me.tenant_id)
        .eq('facility_id', facilityId)
        .eq('year', y)
        .eq('month', m);
      if (sumErr) throw new Error(sumErr.message);
      const sumList = (summaries ?? []) as Array<{
        id: string;
        child_id: string;
        copay_amount: number | null;
        snack_fee: number | null;
        kumon_fee: number | null;
      }>;
      if (sumList.length === 0) continue;

      const summaryIds = sumList.map((s) => s.id);

      /* この event の既存 participation を削除（旧月は削除のみ・新月は再 insert 前のクリア） */
      const { error: delErr } = await supabase
        .from('billing_event_participations')
        .delete()
        .in('billing_summary_id', summaryIds)
        .eq('event_id', eventId);
      if (delErr) throw new Error(delErr.message);

      if (recomputeDate != null) {
        /* 新日付の出席児童を抽出（lib/logic/attendance.ts 一元化） */
        const { data: entries, error: entErr } = await supabase
          .from('schedule_entries')
          .select('child_id, pickup_time, dropoff_time, attendance_status')
          .eq('tenant_id', me.tenant_id)
          .eq('facility_id', facilityId)
          .eq('date', recomputeDate);
        if (entErr) throw new Error(entErr.message);

        const attended = new Set<string>();
        for (const e of (entries ?? []) as Array<{
          child_id: string;
          pickup_time: string | null;
          dropoff_time: string | null;
          attendance_status: string | null;
        }>) {
          if (isAttended(e)) attended.add(e.child_id);
        }

        const inserts = sumList
          .filter((s) => attended.has(s.child_id))
          .map((s) => ({
            billing_summary_id: s.id,
            event_id: eventId,
            participated: true,
            amount: price,
          }));

        if (inserts.length > 0) {
          const { error: insErr } = await supabase
            .from('billing_event_participations')
            .insert(inserts);
          if (insErr) throw new Error(insErr.message);
        }
      }

      /* この月の billing_summaries について event_total / total_amount を再集計。
         participation が変わったので合計値もズレる。料金表を開かずに整合させる。 */
      const { data: allParts, error: partsErr } = await supabase
        .from('billing_event_participations')
        .select('billing_summary_id, amount')
        .in('billing_summary_id', summaryIds);
      if (partsErr) throw new Error(partsErr.message);

      const totalsBySid = new Map<string, number>();
      for (const p of (allParts ?? []) as Array<{ billing_summary_id: string; amount: number | null }>) {
        totalsBySid.set(
          p.billing_summary_id,
          (totalsBySid.get(p.billing_summary_id) ?? 0) + (p.amount ?? 0),
        );
      }

      for (const s of sumList) {
        const eventTotal = totalsBySid.get(s.id) ?? 0;
        const totalAmount =
          (s.copay_amount ?? 0) + (s.snack_fee ?? 0) + (s.kumon_fee ?? 0) + eventTotal;
        const { error: updErr } = await supabase
          .from('billing_summaries')
          .update({ event_total: eventTotal, total_amount: totalAmount })
          .eq('id', s.id);
        if (updErr) throw new Error(updErr.message);
      }
    }
  };

  const handleSave = async () => {
    if (!me || !facilityId) return;
    setSaving(true);
    setError('');
    try {
      /* 新規行: insert / 既存 dirty 行: update */
      const newRows = rows.filter((r) => r.isNew && r.name.trim() !== '');
      const dirtyRows = rows.filter((r) => !r.isNew && r.dirty);

      /* 日付が変わった既存イベントを抽出（出席実績再計算の対象） */
      const dateChanged = dirtyRows
        .map((r) => {
          const orig = originalDatesRef.current.get(r.id);
          return orig && orig !== r.date
            ? { eventId: r.id, oldDate: orig, newDate: r.date, price: Math.max(0, Math.floor(r.price)) }
            : null;
        })
        .filter((x): x is { eventId: string; oldDate: string; newDate: string; price: number } => x != null);

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

      /* events 更新後に participation を出席実績ベースで再計算 */
      for (const change of dateChanged) {
        await syncParticipationsForDateChange(change);
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
          {/* md 以上: テーブル */}
          <div className="hidden md:block rounded border" style={{ borderColor: 'var(--rule)', background: 'var(--white)' }}>
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

          {/* md 未満: カード一覧 */}
          <div className="md:hidden flex flex-col gap-2">
            {rows.length === 0 ? (
              <div
                className="rounded p-4 text-center text-sm"
                style={{ borderColor: 'var(--rule)', border: '1px solid var(--rule)', background: 'var(--white)', color: 'var(--ink-3)' }}
              >
                この月のイベントはまだありません
              </div>
            ) : (
              rows.map((r) => {
                const dt = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? new Date(r.date) : null;
                const dateLabel = dt ? format(dt, 'M月d日（E）', { locale: ja }) : '日付を選択';
                return (
                  <div
                    key={r.id}
                    className="rounded p-3 flex flex-col gap-2"
                    style={{ border: '1px solid var(--rule)', background: 'var(--white)' }}
                  >
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold" style={{ color: 'var(--ink-3)' }}>日付</label>
                      <button
                        type="button"
                        onClick={(e) => {
                          dateAnchorRef.current = e.currentTarget;
                          setOpenRowId(r.id);
                        }}
                        className="outline-none w-full px-2 py-2 rounded text-left transition-colors hover:bg-[var(--accent-pale)]"
                        style={{ background: 'var(--white)', border: '1px solid var(--rule)', color: 'var(--ink)' }}
                      >
                        {dateLabel}
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold" style={{ color: 'var(--ink-3)' }}>イベント名</label>
                      <input
                        type="text"
                        value={r.name}
                        onChange={(e) => updateRow(r.id, { name: e.target.value })}
                        placeholder="例) ピザづくり"
                        className="outline-none w-full px-2 py-2 rounded"
                        style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1 flex flex-col gap-1">
                        <label className="text-[11px] font-semibold" style={{ color: 'var(--ink-3)' }}>金額（円）</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={r.price}
                          onChange={(e) => updateRow(r.id, { price: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                          className="outline-none w-full px-2 py-2 rounded text-right"
                          style={{ background: 'var(--white)', border: '1px solid var(--rule)' }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(r)}
                        className="text-xs font-semibold px-3 py-2 rounded"
                        style={{ color: 'var(--red)', background: 'transparent', border: '1px solid var(--red)' }}
                        aria-label={`${r.name} を削除`}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                );
              })
            )}
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
