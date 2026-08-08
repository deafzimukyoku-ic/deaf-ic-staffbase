'use client';

/**
 * 請求項目設定（migration 222 / docs/features/billing-configurable-items.md §6-1）
 *
 * - 事業所ごとに利用料金表の請求項目を CRUD する
 * - 計算方式は 4 種:
 *     per_day           … 出席日数 × 単価（おやつ等）
 *     per_child_monthly … 児童ごとの月額（教材印刷代。金額は児童設定で入力）
 *     monthly_fixed     … 事業所共通の月額固定
 *     checkbox          … 料金表でチェック ON にすると加算（他施設利用）
 * - 並び順（display_order）がそのまま料金表の列順になる
 *
 * 設計判断:
 * - 組込項目（system_key あり）は **計算方式を変更できない**。過去月の意味が変わってしまうため
 * - スナップショット（billing_summary_fee_amounts）を持つ項目は削除できない（DB 側も on delete restrict）。
 *   UI では理由を出して「有効 OFF」を案内する。過去月の紙の金額を守るのが最優先
 * - 「有効 OFF」にすると以後の月の列から外れるが、過去月を開けば保存済みの金額はそのまま出る
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useShiftFacilityId } from '@/lib/shift-facility';
import Button from '@/components/shift-compat/Button';
import type { BillingFeeItemRow, FeeCalcType } from '@/lib/types';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
}

type EditableItem = {
  id: string;
  name: string;
  calc_type: FeeCalcType;
  unit_amount: number;
  step_amount: number | null;
  system_key: string | null;
  is_active: boolean;
  display_order: number | null;
  isNew?: boolean;
  dirty?: boolean;
};

const CALC_TYPE_LABELS: Record<FeeCalcType, string> = {
  per_day: '出席日数 × 単価',
  per_child_monthly: '児童ごとの月額',
  monthly_fixed: '月額固定',
  checkbox: 'チェックで加算',
};

const CALC_TYPE_HELP: Record<FeeCalcType, string> = {
  per_day: '例: おやつ等。出席日数 × 単価で自動算出。料金表の ▲▼ で月ごとに調整できます',
  per_child_monthly: '例: 教材印刷代。金額は児童設定で児童ごとに入力します（ここでは単価を使いません）',
  monthly_fixed: '出席日数に関係なく毎月この金額。料金表の ▲▼ で月ごとに調整できます',
  checkbox: '例: 他施設利用。料金表でチェックを入れた児童にこの金額を加算します',
};

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function BillingItemSettingsFull({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [shiftFacilityId] = useShiftFacilityId();
  const facilityId = scope === 'manager' ? me?.facility_id ?? '' : shiftFacilityId ?? '';
  const [items, setItems] = useState<EditableItem[]>([]);
  /** fee_item_id → スナップショット件数。0 より大きい項目は削除できない */
  const [usageById, setUsageById] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  const fetchAll = useCallback(async () => {
    if (!me || !facilityId) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('billing_fee_items')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .eq('facility_id', facilityId)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (err) throw new Error(err.message);
      const rows = (data ?? []) as BillingFeeItemRow[];
      setItems(rows.map((r) => ({
        id: r.id,
        name: r.name,
        calc_type: r.calc_type,
        unit_amount: r.unit_amount,
        step_amount: r.step_amount,
        system_key: r.system_key,
        is_active: r.is_active,
        display_order: r.display_order,
      })));

      /* 削除可否の判定材料。スナップショットが 1 件でもあれば削除させない
         （DB 側の on delete restrict と UI を一致させ、押してからエラーになるのを防ぐ） */
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        const { data: used } = await supabase
          .from('billing_summary_fee_amounts')
          .select('fee_item_id')
          .in('fee_item_id', ids);
        const counts: Record<string, number> = {};
        for (const u of ((used ?? []) as { fee_item_id: string }[])) {
          counts[u.fee_item_id] = (counts[u.fee_item_id] ?? 0) + 1;
        }
        setUsageById(counts);
      } else {
        setUsageById({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    } finally {
      setLoading(false);
    }
  }, [supabase, me, facilityId]);

  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const dirtyCount = useMemo(() => items.filter((i) => i.isNew || i.dirty).length, [items]);

  const patch = (id: string, p: Partial<EditableItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p, dirty: true } : i)));
    setNotice('');
  };

  const handleAdd = () => {
    setItems((prev) => [
      ...prev,
      {
        id: genId(),
        name: '',
        calc_type: 'checkbox',
        unit_amount: 0,
        step_amount: null,
        system_key: null,
        is_active: true,
        display_order: (prev.length + 1) * 10,
        isNew: true,
        dirty: true,
      },
    ]);
  };

  const handleMove = (id: string, delta: -1 | 1) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      const to = idx + delta;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      /* 並べ替え後に display_order を振り直す。全行が保存対象になる */
      return next.map((i, n) => ({ ...i, display_order: (n + 1) * 10, dirty: true }));
    });
  };

  const handleDelete = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (item.isNew) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      return;
    }
    const used = usageById[id] ?? 0;
    if (used > 0) {
      setError(`「${item.name}」は保存済みの料金表 ${used} 件で使われているため削除できません。過去の金額を守るためです。今後の月から外したい場合は「有効」のチェックを外してください。`);
      return;
    }
    setError('');
    setSaving(true);
    try {
      const { error: err } = await supabase.from('billing_fee_items').delete().eq('id', id);
      if (err) throw new Error(err.message);
      await fetchAll();
      setNotice(`「${item.name}」を削除しました。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!me || !facilityId) return;
    const blank = items.find((i) => i.name.trim() === '');
    if (blank) { setError('項目名が空の行があります。名前を入力してください。'); return; }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const targets = items.filter((i) => i.isNew || i.dirty);
      for (const i of targets) {
        const payload = {
          tenant_id: me.tenant_id,
          facility_id: facilityId,
          name: i.name.trim(),
          calc_type: i.calc_type,
          /* per_child_monthly は児童設定側が正なので単価は保存しない（0 に固定して誤解を防ぐ） */
          unit_amount: i.calc_type === 'per_child_monthly' ? 0 : Math.max(0, Math.floor(i.unit_amount)),
          step_amount: i.step_amount != null && i.step_amount > 0 ? Math.floor(i.step_amount) : null,
          is_active: i.is_active,
          display_order: i.display_order,
        };
        if (i.isNew) {
          const { error: err } = await supabase.from('billing_fee_items').insert(payload);
          if (err) throw new Error(err.message);
        } else {
          const { error: err } = await supabase.from('billing_fee_items').update(payload).eq('id', i.id);
          if (err) throw new Error(err.message);
        }
      }
      await fetchAll();
      setNotice(`${targets.length} 件を保存しました。利用料金表の列に反映されます。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>🧾 請求項目設定</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" onClick={handleAdd} disabled={!facilityId}>＋ 項目を追加</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || dirtyCount === 0}>
            {saving ? '保存中…' : dirtyCount > 0 ? `保存（${dirtyCount}件未保存）` : '保存済み'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 rounded mb-2" style={{ background: 'var(--red-pale)', color: 'var(--red)', fontSize: '0.85rem' }}>
          <span aria-hidden="true">⚠ </span>{error}
        </div>
      )}
      {notice && (
        <div className="px-4 py-2 rounded mb-2" style={{ background: 'var(--green-pale)', color: 'var(--green)', fontSize: '0.85rem' }}>
          <span aria-hidden="true">✓ </span>{notice}
        </div>
      )}

      {!facilityId ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>事業所が選択されていません。</div>
      ) : loading ? (
        <div className="text-sm" style={{ color: 'var(--ink-3)' }}>読み込み中...</div>
      ) : (
        <div className="overflow-auto rounded border" style={{ borderColor: 'var(--rule-strong)', background: 'var(--white)' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['並び', '項目名', '計算方式', '単価 / 金額', '▲▼ 幅', '有効', '操作'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                      style={{ borderBottom: '2px solid var(--rule-strong)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center" style={{ color: 'var(--ink-3)' }}>
                    請求項目がありません。「＋ 項目を追加」で作成してください。
                  </td>
                </tr>
              )}
              {items.map((i, idx) => {
                const used = usageById[i.id] ?? 0;
                const isBuiltIn = i.system_key != null;
                const needsAmount =
                  i.is_active && i.calc_type !== 'per_child_monthly' && i.unit_amount <= 0;
                return (
                  <tr key={i.id} style={{ borderBottom: '1px solid var(--rule)' }}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleMove(i.id, -1)} disabled={idx === 0}
                          aria-label={`${i.name} を上へ`} title="上へ"
                          style={{ opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? 'default' : 'pointer' }}>▲</button>
                        <button type="button" onClick={() => handleMove(i.id, 1)} disabled={idx === items.length - 1}
                          aria-label={`${i.name} を下へ`} title="下へ"
                          style={{ opacity: idx === items.length - 1 ? 0.3 : 1, cursor: idx === items.length - 1 ? 'default' : 'pointer' }}>▼</button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={i.name}
                        onChange={(e) => patch(i.id, { name: e.target.value })}
                        className="outline-none w-full px-2 py-1 rounded"
                        style={{ background: 'var(--white)', border: '1px solid var(--rule)', minWidth: '140px' }}
                        placeholder="例: おやつ等"
                        aria-label="項目名"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={i.calc_type}
                        onChange={(e) => patch(i.id, { calc_type: e.target.value as FeeCalcType })}
                        disabled={isBuiltIn}
                        className="outline-none px-2 py-1 rounded"
                        style={{ background: isBuiltIn ? 'var(--bg)' : 'var(--white)', border: '1px solid var(--rule)' }}
                        aria-label="計算方式"
                        title={isBuiltIn
                          ? '移行で作られた組込項目のため、計算方式は変更できません（過去月の意味が変わるため）'
                          : CALC_TYPE_HELP[i.calc_type]}
                      >
                        {(Object.keys(CALC_TYPE_LABELS) as FeeCalcType[]).map((k) => (
                          <option key={k} value={k}>{CALC_TYPE_LABELS[k]}</option>
                        ))}
                      </select>
                      <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', marginTop: '2px', maxWidth: '260px' }}>
                        {isBuiltIn ? '組込項目のため方式は固定' : CALC_TYPE_HELP[i.calc_type]}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {i.calc_type === 'per_child_monthly' ? (
                        <span style={{ color: 'var(--ink-3)', fontSize: '0.8rem' }}>児童設定で入力</span>
                      ) : (
                        <>
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={i.unit_amount}
                            onChange={(e) => patch(i.id, { unit_amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                            className="outline-none px-2 py-1 rounded text-right"
                            style={{ background: 'var(--white)', border: '1px solid var(--rule)', width: '100px', fontVariantNumeric: 'tabular-nums' }}
                            aria-label="単価または金額（円）"
                          />
                          <span style={{ fontSize: '0.75rem', color: 'var(--ink-3)' }}>
                            {i.calc_type === 'per_day' ? ' 円/日' : ' 円'}
                          </span>
                          {/* 金額 0 のまま有効化されている項目は列が出ても加算されないので警告する */}
                          {needsAmount && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--red)', marginTop: '2px' }}>
                              <span aria-hidden="true">⚠ </span>金額が未設定です（0 円のままだと加算されません）
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {i.calc_type === 'per_child_monthly' ? (
                        <span style={{ color: 'var(--ink-3)', fontSize: '0.8rem' }}>—</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={i.step_amount ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            patch(i.id, { step_amount: v === '' ? null : Math.max(0, Math.floor(Number(v) || 0)) });
                          }}
                          className="outline-none px-2 py-1 rounded text-right"
                          style={{ background: 'var(--white)', border: '1px solid var(--rule)', width: '90px', fontVariantNumeric: 'tabular-nums' }}
                          placeholder="単価と同じ"
                          aria-label="▲▼ の 1 ステップ幅（円）"
                          title="料金表の ▲▼ で 1 回に増減する金額。空欄なら単価と同じ幅になります"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={i.is_active}
                          onChange={(e) => patch(i.id, { is_active: e.target.checked })}
                          aria-label={`${i.name} を有効にする`}
                        />
                        <span style={{ fontSize: '0.78rem', color: i.is_active ? 'var(--ink)' : 'var(--ink-3)' }}>
                          {i.is_active ? '有効' : '停止中'}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleDelete(i.id)}
                        disabled={saving || used > 0}
                        style={{
                          color: used > 0 ? 'var(--ink-3)' : 'var(--red)',
                          cursor: used > 0 ? 'not-allowed' : 'pointer',
                          fontSize: '0.8rem',
                        }}
                        title={used > 0
                          ? `保存済みの料金表 ${used} 件で使用中のため削除できません。今後の月から外すには「有効」を外してください`
                          : '削除'}
                      >
                        {used > 0 ? '削除不可' : '削除'}
                      </button>
                      {used > 0 && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--ink-3)' }}>使用中 {used} 件</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs mt-3" style={{ color: 'var(--ink-3)' }}>
        ※ ここで設定した項目が、利用料金表の列としてこの並び順で表示されます。
        <br />
        ※ <b>「有効」を外す</b>と今後の月の列から外れます。過去に保存した月を開けば、そのときの金額はそのまま残ります。
        <br />
        ※ すでに保存済みの料金表で使われている項目は<b>削除できません</b>（過去の請求額を守るためです）。「有効」を外してください。
        <br />
        ※ 「児童ごとの月額」を選んだ項目の金額は、<b>児童設定</b>で児童ごとに入力します。
        <br />
        ※ 単価を変更しても、<b>すでに保存済みの月の金額は変わりません</b>。変更が効くのはこれから保存する月です。
      </p>
    </div>
  );
}
