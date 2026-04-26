'use client';

/**
 * 閲覧レポート — 4 カテゴリ（遵守事項/研修/お知らせ/業務マニュアル）共通の集計表示
 *
 * 提供するビュー:
 *   - サマリーカード: 社員数 / アイテム数 / 全体既読率
 *   - マトリクス: 社員 × アイテム、セルに ✓✗ + 回数 + 最終閲覧日
 *   - CSV エクスポート（マトリクスをそのまま）
 *
 * 期間フィルタ: 全期間 / 過去30日 / 過去7日。
 * オーディエンス判定: アイテムの target_type='all' なら全員、'facility' なら
 * employee.facility_id ∈ target_facility_ids の社員のみが対象。対象外セルは「—」。
 */

import { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Category = 'compliance' | 'training' | 'announcement' | 'manual';

const CATEGORY_LABELS: Record<Category, { label: string; icon: string }> = {
  compliance: { label: '遵守事項', icon: '✅' },
  training: { label: '研修', icon: '📚' },
  announcement: { label: 'お知らせ', icon: '📢' },
  manual: { label: '業務マニュアル', icon: '📘' },
};

interface ItemRow {
  id: string;
  title: string;
  target_type: 'all' | 'facility';
  target_facility_ids: string[];
  category_id: string | null;
  created_at: string;
}
interface EmpRow {
  id: string;
  name: string;
  facility_id: string | null;
  facility_name: string;
  role: string;
}
interface ViewAgg {
  employee_id: string;
  item_id: string;
  count: number;
  last_viewed_at: string;
}
interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}
interface ReportData {
  items: ItemRow[];
  employees: EmpRow[];
  views: ViewAgg[];
  categories: CategoryRow[];
}

const PERIOD_OPTIONS = [
  { value: 'all', label: '全期間' },
  { value: '30', label: '過去30日' },
  { value: '7', label: '過去7日' },
] as const;

export function ReportMatrix() {
  const [category, setCategory] = useState<Category>('compliance');
  const [days, setDays] = useState<string>('all');
  /* カテゴリ別フィルタ。'all' = すべて / 'uncategorized' = 未設定 / それ以外 = category id */
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reports?category=${category}&days=${days}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'fetch error');
        if (!cancelled) {
          setData(json as ReportData);
          setCategoryFilter('all'); /* 種別タブ切替時はリセット */
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [category, days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">📊 閲覧レポート</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-diletto-gray">期間</label>
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="h-9 rounded-md border border-diletto-gray/20 bg-white px-3 text-sm"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs value={category} onValueChange={(v) => setCategory(v as Category)}>
        <TabsList>
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
            <TabsTrigger key={c} value={c}>
              <span className="mr-1">{CATEGORY_LABELS[c].icon}</span>
              {CATEGORY_LABELS[c].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
          <TabsContent key={c} value={c}>
            {loading && <p className="py-8 text-center text-sm text-diletto-gray-light">読み込み中...</p>}
            {error && <p className="py-8 text-center text-sm text-diletto-red">エラー: {error}</p>}
            {!loading && !error && data && (
              <ReportBody
                data={data}
                category={c}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={setCategoryFilter}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ReportBody({
  data,
  category,
  categoryFilter,
  onCategoryFilterChange,
}: {
  data: ReportData;
  category: Category;
  categoryFilter: string;
  onCategoryFilterChange: (v: string) => void;
}) {
  const { employees, views, categories } = data;

  /* カテゴリフィルタ適用後の items。
     'all' 表示時はカテゴリ順 → カテゴリ内 sort_order 順で並べ替えて、
     同カテゴリの列が隣接するようにする（後でグループ見出しを乗せる）。 */
  const items = useMemo(() => {
    let filtered: ItemRow[];
    if (categoryFilter === 'all') filtered = data.items;
    else if (categoryFilter === 'uncategorized') filtered = data.items.filter((it) => !it.category_id);
    else filtered = data.items.filter((it) => it.category_id === categoryFilter);

    if (categoryFilter !== 'all') return filtered;

    /* カテゴリの並び順を index ベースの map に。未設定 (null) は末尾。 */
    const catOrder = new Map(categories.map((c, i) => [c.id, i]));
    return filtered.map((it, idx) => ({ it, idx }))
      .sort((a, b) => {
        const ca = a.it.category_id ? (catOrder.get(a.it.category_id) ?? 9999) : 99999;
        const cb = b.it.category_id ? (catOrder.get(b.it.category_id) ?? 9999) : 99999;
        if (ca !== cb) return ca - cb;
        return a.idx - b.idx; /* 同カテゴリ内は API の並び（sort_order → created_at）を温存 */
      })
      .map(({ it }) => it);
  }, [data.items, categoryFilter, categories]);

  /* 未設定アイテムが何件あるか（フィルタの「未設定」表示有無の判定用） */
  const uncategorizedCount = useMemo(
    () => data.items.filter((it) => !it.category_id).length,
    [data.items],
  );

  /* 'all' 表示時のカテゴリグループ。連続する同カテゴリ列をまとめて colSpan を計算。 */
  const categoryGroups = useMemo(() => {
    if (categoryFilter !== 'all') return null;
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const groups: { catId: string | null; catName: string; icon: string | null; color: string | null; count: number }[] = [];
    for (const it of items) {
      const cat = it.category_id ? catMap.get(it.category_id) ?? null : null;
      const last = groups[groups.length - 1];
      const catId = cat?.id ?? null;
      if (last && last.catId === catId) {
        last.count += 1;
      } else {
        groups.push({
          catId,
          catName: cat?.name ?? '未設定',
          icon: cat?.icon ?? null,
          color: cat?.color ?? null,
          count: 1,
        });
      }
    }
    return groups;
  }, [items, categories, categoryFilter]);

  /* (employee_id, item_id) → ViewAgg のルックアップ */
  const viewMap = useMemo(() => {
    const m = new Map<string, ViewAgg>();
    for (const v of views) m.set(`${v.employee_id}__${v.item_id}`, v);
    return m;
  }, [views]);

  /* 各アイテムについて、対象オーディエンス（その施設の社員）を返す。
     target_type='all' は全員、'facility' は target_facility_ids に含まれる社員のみ。 */
  function audienceFor(item: ItemRow): EmpRow[] {
    if (item.target_type === 'all') return employees;
    const set = new Set(item.target_facility_ids);
    return employees.filter((e) => e.facility_id && set.has(e.facility_id));
  }

  /* 全体既読率 = (対象 × 既読セル数) / (対象セル総数)。「対象外」セルは分母から除外。 */
  let totalCells = 0;
  let readCells = 0;
  for (const it of items) {
    const aud = audienceFor(it);
    totalCells += aud.length;
    for (const e of aud) {
      const v = viewMap.get(`${e.id}__${it.id}`);
      if (v && v.count > 0) readCells += 1;
    }
  }
  const readRate = totalCells > 0 ? Math.round((readCells / totalCells) * 100) : 0;

  function exportCsv() {
    /* マトリクス CSV: 行=社員、列=アイテム。セルは閲覧回数（対象外は空、未読は0）。 */
    const head = ['社員', '所属', ...items.map((it) => it.title)];
    const rows = employees.map((e) => {
      const cells = items.map((it) => {
        const aud = audienceFor(it);
        if (!aud.find((x) => x.id === e.id)) return '';
        const v = viewMap.get(`${e.id}__${it.id}`);
        return v ? String(v.count) : '0';
      });
      return [e.name, e.facility_name, ...cells];
    });
    const csv = [head, ...rows].map((row) =>
      row.map((cell) => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ).join('\n');
    /* Excel が UTF-8 を正しく読むよう BOM 付き */
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${CATEGORY_LABELS[category].label}_閲覧レポート_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-diletto-gray-light">
          {CATEGORY_LABELS[category].label}が登録されていません
        </CardContent>
      </Card>
    );
  }
  if (employees.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-diletto-gray-light">
          対象社員がいません
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* カテゴリフィルタ + CSV ダウンロード */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-diletto-gray">カテゴリ</label>
          <select
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value)}
            className="h-9 rounded-md border border-diletto-gray/20 bg-white px-3 text-sm"
          >
            <option value="all">すべて ({data.items.length})</option>
            {categories.map((cat) => {
              const count = data.items.filter((it) => it.category_id === cat.id).length;
              return (
                <option key={cat.id} value={cat.id}>
                  {cat.icon ? `${cat.icon} ` : ''}{cat.name} ({count})
                </option>
              );
            })}
            {uncategorizedCount > 0 && (
              <option value="uncategorized">📁 未設定 ({uncategorizedCount})</option>
            )}
          </select>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={items.length === 0 || employees.length === 0}>
          📥 CSV ダウンロード
        </Button>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="社員数" value={`${employees.length} 名`} />
        <SummaryCard label="アイテム数" value={`${items.length} 件`} />
        <SummaryCard label="既読セル" value={`${readCells} / ${totalCells}`} />
        <SummaryCard label="全体既読率" value={`${readRate}%`} highlight={readRate < 50} />
      </div>

      {/* マトリクス */}
      <Card>
        <CardContent className="p-0 overflow-auto">
          {/* 表全体: テーブルは内容幅で広がる（max-content）、外側の overflow-auto で横スクロール。
             1列目「社員」だけ sticky left-0 で固定。
             border-collapse: separate にしないと sticky cell の背景が透けるブラウザバグがあるため
             border-separate を使い、罫線は box-shadow inset で再現。
             whitespace-nowrap で氏名・所属が縦折りされないように。 */}
          <table className="text-xs border-separate w-max min-w-full" style={{ borderSpacing: 0 }}>
            <thead>
              {/* カテゴリグループ行: 'すべて' 表示時のみ。
                 連続する同カテゴリ列を colSpan でまとめて、視覚的に区切る。 */}
              {categoryGroups && categoryGroups.length > 0 && (
                <tr>
                  {/* 社員 + 所属の 2 列分は空欄 */}
                  <th
                    className="sticky left-0 z-20"
                    style={{
                      background: '#f5f4f0',
                      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                    }}
                  />
                  <th
                    style={{
                      background: '#f5f4f0',
                      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                    }}
                  />
                  {categoryGroups.map((g, idx) => (
                    <th
                      key={`${g.catId ?? 'uncat'}_${idx}`}
                      colSpan={g.count}
                      className="px-2 py-2 text-left whitespace-nowrap"
                      style={{
                        background: g.color || '#eef2f7',
                        color: '#1f2937',
                        boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.12)',
                      }}
                    >
                      {/* 横スクロールでも見出しが残るよう、ラベルを sticky に。
                         left は社員(min 約140px) + 所属(min 約84px) ≒ 224px の offset を空けて、
                         スクロールしてもラベルが sticky 列の右側に残り続ける。 */}
                      <span
                        className="text-sm font-bold inline-block"
                        style={{ position: 'sticky', left: '232px' }}
                      >
                        {g.icon ? `${g.icon} ` : ''}
                        {g.catName}
                        <span className="ml-1 text-xs font-normal opacity-70">({g.count})</span>
                      </span>
                    </th>
                  ))}
                </tr>
              )}
              <tr className="bg-diletto-bg sticky top-0 z-10">
                <th
                  className="text-left px-3 py-2 sticky left-0 z-20 whitespace-nowrap"
                  style={{
                    background: '#f5f4f0',
                    boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                  }}
                >
                  社員
                </th>
                <th
                  className="text-left px-3 py-2 whitespace-nowrap"
                  style={{
                    background: '#f5f4f0',
                    boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                  }}
                >
                  所属
                </th>
                {items.map((it) => (
                  <th
                    key={it.id}
                    className="text-left px-2 py-2 min-w-[160px] align-bottom"
                    style={{
                      background: '#f5f4f0',
                      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.08), inset -1px 0 0 rgba(0,0,0,0.08)',
                    }}
                  >
                    <span className="block max-w-[220px] truncate" title={it.title}>{it.title}</span>
                    <span className="text-[10px] text-diletto-gray-light font-normal">
                      {it.target_type === 'facility' ? '🏢 施設限定' : '全員'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td
                    className="px-3 py-2 sticky left-0 z-10 font-medium whitespace-nowrap"
                    style={{
                      background: '#ffffff',
                      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)',
                    }}
                  >
                    {e.name}
                  </td>
                  <td
                    className="px-3 py-2 text-diletto-gray-light whitespace-nowrap bg-white"
                    style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                  >
                    {e.facility_name || '-'}
                  </td>
                  {items.map((it) => {
                    const aud = audienceFor(it);
                    const isAudience = aud.find((x) => x.id === e.id);
                    if (!isAudience) {
                      return (
                        <td
                          key={it.id}
                          className="px-2 py-2 text-center text-diletto-gray-light/40 bg-white"
                          style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                        >
                          —
                        </td>
                      );
                    }
                    const v = viewMap.get(`${e.id}__${it.id}`);
                    if (!v || v.count === 0) {
                      return (
                        <td
                          key={it.id}
                          className="px-2 py-2 text-center text-diletto-red whitespace-nowrap"
                          style={{
                            background: '#fcf2f2',
                            boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)',
                          }}
                        >
                          ✗ 未読
                        </td>
                      );
                    }
                    return (
                      <td
                        key={it.id}
                        className="px-2 py-2 whitespace-nowrap bg-white"
                        style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                      >
                        <div className="text-diletto-blue font-medium">✓ {v.count} 回</div>
                        <div className="text-[10px] text-diletto-gray-light">{formatDate(v.last_viewed_at)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-[10px] text-diletto-gray-light font-bold uppercase tracking-wider">{label}</p>
        <p className={`text-xl font-bold mt-1 ${highlight ? 'text-diletto-red' : 'text-diletto-ink'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}/${mm}/${dd}`;
}
