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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { TRAINING_RESULT } from '@/lib/constants';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { isItemInAudience } from '@/lib/multi-facility';

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
  /* position 限定アイテムも audience 判定に含めるため、ReportData にも持たせる (API 側で同時取得済み) */
  target_position_ids?: string[] | null;
  category_id: string | null;
  created_at: string;
}
interface EmpRow {
  id: string;
  /** 従業員番号 (string だが数値主体)。 ReportMatrix では数値優先で昇順ソートに使う */
  employee_number: string | null;
  name: string;
  facility_id: string | null;
  facility_name: string;
  role: string;
  /* audience 判定用。null/undefined の場合は position 指定アイテムから除外される */
  position_id?: string | null;
  /* 兼任 facility (employee_facilities)。複数所属社員向け */
  additional_facility_ids?: string[] | null;
}

/* 従業員番号順ソート: 数値変換できれば数値、それ以外は ja-locale 文字列比較、
   未設定 (NULL / 空) は末尾。 §4.8 ProgressDashboard と同じ実装。 */
function sortByEmployeeNumber(a: EmpRow, b: EmpRow): number {
  const an = String(a.employee_number ?? '').trim();
  const bn = String(b.employee_number ?? '').trim();
  if (!an && !bn) return 0;
  if (!an) return 1;
  if (!bn) return -1;
  const aNum = Number(an);
  const bNum = Number(bn);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return an.localeCompare(bn, 'ja');
}
interface ViewAgg {
  employee_id: string;
  item_id: string;
  count: number;
  last_viewed_at: string;
  /* 直近10件の閲覧日時 (新しい順, ISO)。② tooltip 表示用 */
  recent_views: string[];
}
interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}
/* ① 研修の合否判定 用: category='training' のときのみ含まれる */
interface SubmissionRow {
  id: string;
  training_id: string;
  employee_id: string;
  result: string;       /* 'pending' | 'passed' | 'failed' | 'resubmit' */
  summary_text: string | null;
  admin_comment: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}
interface ReportData {
  items: ItemRow[];
  employees: EmpRow[];
  views: ViewAgg[];
  categories: CategoryRow[];
  submissions?: SubmissionRow[];
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold whitespace-nowrap">📊 閲覧レポート</h1>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs text-brand-gray whitespace-nowrap">期間</label>
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="h-9 rounded-md border border-brand-gray/20 bg-white px-3 text-sm"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs value={category} onValueChange={(v) => setCategory(v as Category)}>
        {/* モバイル: 横スクロール / lg 以上: 等幅。設定画面のタブと統一感 */}
        <TabsList className="w-full max-w-full h-12 bg-brand-beige/40 border border-brand-gray/10 rounded-xl p-1 overflow-x-auto no-scrollbar justify-start lg:justify-stretch gap-0.5">
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
            <TabsTrigger
              key={c}
              value={c}
              className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-brand-gray-light hover:text-brand-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-brand-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all"
            >
              <span className="mr-1">{CATEGORY_LABELS[c].icon}</span>
              {CATEGORY_LABELS[c].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
          <TabsContent key={c} value={c}>
            {loading && <p className="py-8 text-center text-sm text-brand-gray-light">読み込み中...</p>}
            {error && <p className="py-8 text-center text-sm text-brand-red">エラー: {error}</p>}
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
  /* 社員一覧は従業員番号順に並び替え(数値優先、未設定は末尾) */
  const employees = [...data.employees].sort(sortByEmployeeNumber);
  const { views, categories } = data;

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

  /* ① 研修の合否判定: (training_id, employee_id) → SubmissionRow[] ルックアップ
     API 側で submitted_at DESC ソート済みなので、配列の [0] が最新。
     submissionOverrides は判定保存後の楽観更新 (server refetch なしで UI を即時反映するため) */
  const submissions = data?.submissions ?? [];
  const [submissionOverrides, setSubmissionOverrides] = useState<Record<string, Partial<SubmissionRow>>>({});
  /* (emp, training) → 全提出履歴の配列 (新しい順)。Tooltip 表示と最新値取得に使う */
  const submissionHistoryMap = useMemo(() => {
    const m = new Map<string, SubmissionRow[]>();
    for (const s of submissions) {
      const override = submissionOverrides[s.id];
      const merged = override ? { ...s, ...override } : s;
      const key = `${s.employee_id}__${s.training_id}`;
      const arr = m.get(key) ?? [];
      arr.push(merged);
      m.set(key, arr);
    }
    return m;
  }, [submissions, submissionOverrides]);
  /* (emp, training) → 最新の SubmissionRow (バッジ・判定モーダル用) */
  const submissionMap = useMemo(() => {
    const m = new Map<string, SubmissionRow>();
    for (const [key, arr] of submissionHistoryMap) {
      if (arr.length > 0) m.set(key, arr[0]);
    }
    return m;
  }, [submissionHistoryMap]);

  /* ① 研修の合否判定 モーダル */
  const [reviewTarget, setReviewTarget] = useState<{
    employeeId: string;
    employeeName: string;
    trainingId: string;
    trainingTitle: string;
    submission: SubmissionRow | undefined;
  } | null>(null);
  const [reviewResult, setReviewResult] = useState('pending');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);

  function openReview(employeeId: string, employeeName: string, trainingId: string, trainingTitle: string) {
    const submission = submissionMap.get(`${employeeId}__${trainingId}`);
    setReviewTarget({ employeeId, employeeName, trainingId, trainingTitle, submission });
    setReviewResult(submission?.result || 'pending');
    setReviewComment(submission?.admin_comment || '');
  }

  async function handleReviewSave() {
    if (!reviewTarget || !reviewTarget.submission) {
      toast.error('提出データがありません');
      return;
    }
    setReviewSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('training_submissions')
      .update({
        result: reviewResult,
        admin_comment: reviewComment || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', reviewTarget.submission.id);
    setReviewSaving(false);
    if (error) {
      toast.error('保存に失敗しました', { description: error.message });
      return;
    }
    toast.success('判定を保存しました');
    /* 楽観更新: 子コンポーネントなので親 state を再 fetch せず、ローカル overrides に反映 */
    setSubmissionOverrides((prev) => ({
      ...prev,
      [reviewTarget.submission!.id]: {
        result: reviewResult,
        admin_comment: reviewComment || null,
        reviewed_at: new Date().toISOString(),
      },
    }));
    setReviewTarget(null);
  }

  /* 各アイテムについて、対象オーディエンス（target_type + target_facility_ids + target_position_ids）
     の社員リストを返す。lib/multi-facility.ts の isItemInAudience と同じ判定 (集約済み)。
     兼任 (additional_facility_ids) + position 限定も AND で考慮する。 */
  function audienceFor(item: ItemRow): EmpRow[] {
    return employees.filter((e) => {
      const myFacilityIds: string[] = [];
      if (e.facility_id) myFacilityIds.push(e.facility_id);
      for (const f of e.additional_facility_ids ?? []) {
        if (!myFacilityIds.includes(f)) myFacilityIds.push(f);
      }
      return isItemInAudience(
        { target_type: item.target_type, target_facility_ids: item.target_facility_ids, target_position_ids: item.target_position_ids ?? null },
        myFacilityIds,
        e.position_id ?? null,
      );
    });
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
        <CardContent className="py-12 text-center text-sm text-brand-gray-light">
          {CATEGORY_LABELS[category].label}が登録されていません
        </CardContent>
      </Card>
    );
  }
  if (employees.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-brand-gray-light">
          対象社員がいません
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* カテゴリフィルタ + CSV ダウンロード - モバイルでは縦並び */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label className="text-xs text-brand-gray whitespace-nowrap shrink-0">カテゴリ</label>
          <select
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value)}
            className="h-9 flex-1 min-w-0 rounded-md border border-brand-gray/20 bg-white px-3 text-sm"
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
        <Button size="sm" variant="outline" className="whitespace-nowrap shrink-0 self-end sm:self-auto" onClick={exportCsv} disabled={items.length === 0 || employees.length === 0}>
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
              <tr className="bg-brand-bg sticky top-0 z-10">
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
                    <span className="text-[10px] text-brand-gray-light font-normal">
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
                    className="px-3 py-2 text-brand-gray-light whitespace-nowrap bg-white"
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
                          className="px-2 py-2 text-center text-brand-gray-light/40 bg-white"
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
                          className="px-2 py-2 text-center text-brand-red whitespace-nowrap"
                          style={{
                            background: '#fcf2f2',
                            boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)',
                          }}
                        >
                          ✗ 未読
                        </td>
                      );
                    }
                    /* ② tooltip 用に最近の閲覧履歴を YYYY/MM/DD HH:mm:ss で連結 */
                    const tooltipText = v.recent_views && v.recent_views.length > 0
                      ? `直近${v.recent_views.length}回:\n` + v.recent_views.map((iso) => formatDateTime(iso)).join('\n')
                      : `最終閲覧: ${formatDateTime(v.last_viewed_at)}`;
                    /* ① 研修のみ: 提出データから合否バッジ + 判定ボタンを表示 */
                    const sub = category === 'training' ? submissionMap.get(`${e.id}__${it.id}`) : undefined;
                    /* ⑨ 合否履歴 tooltip: 全提出履歴（新しい順）を 提出日時 → 判定結果 → 判定日時 → コメント の形で連結 */
                    const subHistory = category === 'training' ? (submissionHistoryMap.get(`${e.id}__${it.id}`) || []) : [];
                    const resultLabel = (r: string) => r === 'passed' ? '合格' : r === 'failed' ? '不合格' : r === 'resubmit' ? '再提出' : '未判定';
                    const subTooltipText = subHistory.length > 0
                      ? `提出${subHistory.length}回:\n` + subHistory.map((s, i) => {
                          const lines = [`【${subHistory.length - i}回目】 ${formatDateTime(s.submitted_at)} 提出`];
                          if (s.reviewed_at) {
                            lines.push(`  → ${formatDateTime(s.reviewed_at)} ${resultLabel(s.result)}`);
                          } else {
                            lines.push(`  → ${resultLabel(s.result)} (未判定)`);
                          }
                          if (s.admin_comment) lines.push(`  コメント: ${s.admin_comment}`);
                          return lines.join('\n');
                        }).join('\n')
                      : '';
                    return (
                      <td
                        key={it.id}
                        className="px-2 py-2 whitespace-nowrap bg-white"
                        style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.06), inset -1px 0 0 rgba(0,0,0,0.06)' }}
                      >
                        <div className="text-brand-blue font-medium" title={tooltipText} style={{ cursor: 'help' }}>
                          ✓ {v.count} 回
                        </div>
                        <div className="text-[10px] text-brand-gray-light">{formatDate(v.last_viewed_at)}</div>
                        {category === 'training' && (
                          <div className="mt-1 flex items-center gap-1">
                            {sub ? (
                              <Badge
                                variant="outline"
                                title={subTooltipText}
                                style={{ cursor: 'help' }}
                                className={
                                  sub.result === 'passed' ? 'bg-brand-green/10 text-brand-green border-brand-green/30' :
                                  sub.result === 'failed' ? 'bg-brand-red/10 text-brand-red border-brand-red/30' :
                                  sub.result === 'resubmit' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                                  'bg-brand-gray/10 text-brand-gray border-brand-gray/20'
                                }
                              >
                                {sub.result === 'passed' ? '合格' :
                                 sub.result === 'failed' ? '不合格' :
                                 sub.result === 'resubmit' ? '再提出' : '未判定'}
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-brand-gray-light">提出待ち</span>
                            )}
                            {sub && (
                              <button
                                type="button"
                                onClick={() => openReview(e.id, e.name, it.id, it.title)}
                                className="text-[10px] underline text-brand-blue hover:text-brand-ink"
                              >
                                判定
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ① 研修合否判定モーダル */}
      <Dialog open={reviewTarget != null} onOpenChange={(o) => { if (!o) setReviewTarget(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {reviewTarget?.employeeName}「{reviewTarget?.trainingTitle}」の判定
            </DialogTitle>
          </DialogHeader>
          {reviewTarget?.submission ? (
            <div className="space-y-4 py-2">
              <div>
                <div className="text-xs text-brand-gray-light mb-1">受講の感想 ({reviewTarget.submission.summary_text?.length || 0} 文字)</div>
                <div className="rounded-md border border-brand-gray/15 bg-brand-beige/30 p-3 text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                  {reviewTarget.submission.summary_text || '（記入なし）'}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold mb-2">判定</div>
                <div className="flex gap-2 flex-wrap">
                  {TRAINING_RESULT.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReviewResult(r)}
                      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                        reviewResult === r
                          ? r === 'passed' ? 'bg-brand-green text-white border-brand-green'
                          : r === 'failed' ? 'bg-brand-red text-white border-brand-red'
                          : r === 'resubmit' ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-brand-gray text-white border-brand-gray'
                          : 'bg-white text-brand-ink border-brand-gray/30 hover:bg-brand-beige'
                      }`}
                    >
                      {r === 'passed' ? '合格' : r === 'failed' ? '不合格' : r === 'resubmit' ? '再提出' : '未判定'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1">コメント (任意)</div>
                <Textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows={3}
                  placeholder="再提出を依頼する場合は何を直してほしいか書いてください"
                />
              </div>
            </div>
          ) : (
            <p className="py-4 text-sm text-brand-gray">提出データがありません。</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>キャンセル</Button>
            <Button onClick={handleReviewSave} disabled={reviewSaving || !reviewTarget?.submission}>
              {reviewSaving ? '保存中...' : '判定を保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-[10px] text-brand-gray-light font-bold uppercase tracking-wider">{label}</p>
        <p className={`text-xl font-bold mt-1 ${highlight ? 'text-brand-red' : 'text-brand-ink'}`}>{value}</p>
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
