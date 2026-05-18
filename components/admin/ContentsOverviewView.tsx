'use client';

/* 4 機能 (お知らせ / 遵守事項 / 研修 / 業務マニュアル) を横断する投稿一覧。
   - admin / manager 両方で同じ UI
   - カテゴリ順 → カテゴリ内タイトル順で並び替え
   - 列: カテゴリ / タイトル / 内容 (ポップで全文) / URL / 公開
   - URL 重複: 同じ URL を含む投稿が他にもあれば赤バッジ、ホバーで「どこと重複してるか」を pop
   - タイトルクリックで該当機能の管理ページへ */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type FeatureKey = 'announcement' | 'compliance' | 'training' | 'manual';

const FEATURE_LABEL: Record<FeatureKey, string> = {
  announcement: 'お知らせ',
  compliance: '遵守事項',
  training: '研修',
  manual: '業務マニュアル',
};

const FEATURE_BADGE_CLASS: Record<FeatureKey, string> = {
  announcement: 'bg-blue-100 text-blue-800 border-blue-300',
  compliance: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  training: 'bg-amber-100 text-amber-800 border-amber-300',
  manual: 'bg-purple-100 text-purple-800 border-purple-300',
};

const FEATURE_ICON: Record<FeatureKey, string> = {
  announcement: '📢',
  compliance: '✅',
  training: '📚',
  manual: '📖',
};

/* 種別の表示順 (ユーザー要望): 遵守 → 研修 → お知らせ → マニュアル */
const FEATURE_ORDER: FeatureKey[] = ['compliance', 'training', 'announcement', 'manual'];

interface RawRow {
  id: string;
  title: string | null;
  category_id: string | null;
  is_published: boolean;
  content_blocks: unknown;
  body: string | null;
  content: string | null; /* compliance_documents 用 */
  created_by: string | null;
  sort_order: number | null; /* 各機能で admin が決めた並び順 */
}

interface Row {
  feature: FeatureKey;
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string;
  categorySortOrder: number; /* カテゴリ並び替え用 */
  postSortOrder: number; /* 投稿の admin 並び順 (各機能内 sort_order) */
  isPublished: boolean;
  textContent: string; /* ポップで表示する全文 */
  urls: string[];
  editLink: string;
  creatorName: string; /* 投稿者 (created_by の氏名) */
}

interface Props {
  scope: 'admin' | 'manager';
}

/* URL 抽出: content_blocks (jsonb) を文字列化 + body / content と結合してから http(s) URL を拾う。
   末尾の句読点や閉じ括弧は除外する。 */
function extractUrls(...sources: (string | null | undefined | unknown)[]): string[] {
  const text = sources.map((s) => (typeof s === 'string' ? s : JSON.stringify(s ?? ''))).join(' ');
  const matches = text.match(/https?:\/\/[^\s<>"'()、。「」　]+/g) ?? [];
  /* 末尾のピリオド / カンマ / コロンを除去 (テキスト末尾に句読点が混入しがち) */
  const cleaned = matches.map((u) => u.replace(/[.,:;!?]+$/, ''));
  return Array.from(new Set(cleaned));
}

/* content_blocks から人間可読テキストを抽出 (ポップ表示用) */
function blocksToText(blocks: unknown, body: string | null, content: string | null): string {
  const parts: string[] = [];
  if (Array.isArray(blocks)) {
    for (const b of blocks) {
      if (b && typeof b === 'object') {
        const v = (b as { type?: string; value?: unknown }).value;
        const type = (b as { type?: string }).type;
        if (typeof v === 'string') parts.push(v);
        else if (type === 'image' && v && typeof v === 'object' && 'url' in (v as Record<string, unknown>)) {
          parts.push(`[画像] ${(v as { url: string }).url}`);
        }
      }
    }
  }
  if (body && body.trim()) parts.push(body.trim());
  if (content && content.trim()) parts.push(content.trim());
  return parts.join('\n').trim();
}

export function ContentsOverviewView({ scope }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [contentPreview, setContentPreview] = useState<{ title: string; text: string } | null>(null);

  /* フィルタ */
  const [query, setQuery] = useState('');
  const [featureFilter, setFeatureFilter] = useState<'all' | FeatureKey>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all'); /* category_id or 'all' / '__none__' */
  const [publishFilter, setPublishFilter] = useState<'all' | 'published' | 'unpublished'>('all');

  /* 種別ごとアコーディオン (初期値: 全部開く) */
  const [openFeatures, setOpenFeatures] = useState<Set<FeatureKey>>(
    () => new Set(FEATURE_ORDER)
  );
  function toggleFeature(k: FeatureKey) {
    setOpenFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: me } = await supabase
        .from('employees')
        .select('tenant_id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (!me) { setLoading(false); return; }
      const tenantId = me.tenant_id;
      const base = scope === 'admin' ? '/admin' : '/mgr';

      const [ann, comp, train, man, cats, emps] = await Promise.all([
        supabase.from('announcements').select('id, title, category_id, is_published, content_blocks, body, created_by, sort_order').eq('tenant_id', tenantId),
        supabase.from('compliance_documents').select('id, title, category_id, is_published, content_blocks, content, created_by, sort_order').eq('tenant_id', tenantId),
        supabase.from('trainings').select('id, title, category_id, is_published, content_blocks, body, created_by, sort_order').eq('tenant_id', tenantId),
        supabase.from('manuals').select('id, title, category_id, is_published, content_blocks, body, created_by, sort_order').eq('tenant_id', tenantId),
        supabase.from('categories').select('id, name, type, sort_order').eq('tenant_id', tenantId),
        supabase.from('employees').select('id, last_name, first_name').eq('tenant_id', tenantId),
      ]);

      const catInfo = new Map<string, { name: string; sort: number }>();
      for (const c of (cats.data ?? []) as Array<{ id: string; name: string; sort_order: number | null }>) {
        catInfo.set(c.id, { name: c.name, sort: c.sort_order ?? 9999 });
      }
      const empName = new Map<string, string>();
      for (const e of (emps.data ?? []) as Array<{ id: string; last_name: string | null; first_name: string | null }>) {
        empName.set(e.id, `${e.last_name ?? ''} ${e.first_name ?? ''}`.trim() || '(名前未設定)');
      }

      function toRow(feature: FeatureKey, basePath: string) {
        return (r: RawRow): Row => {
          const info = r.category_id ? catInfo.get(r.category_id) : undefined;
          return {
            feature,
            id: r.id,
            title: r.title ?? '(無題)',
            categoryId: r.category_id,
            categoryName: info?.name ?? '(未分類)',
            categorySortOrder: info?.sort ?? 9999,
            postSortOrder: r.sort_order ?? 9999,
            isPublished: r.is_published,
            textContent: blocksToText(r.content_blocks, r.body, r.content),
            urls: extractUrls(r.content_blocks, r.body, r.content),
            editLink: `${base}${basePath}`,
            creatorName: r.created_by ? (empName.get(r.created_by) ?? '(削除済)') : '(不明)',
          };
        };
      }

      const all: Row[] = [
        ...((ann.data ?? []) as RawRow[]).map(toRow('announcement', '/announcements')),
        ...((comp.data ?? []) as RawRow[]).map(toRow('compliance', '/compliance')),
        ...((train.data ?? []) as RawRow[]).map(toRow('training', '/trainings')),
        ...((man.data ?? []) as RawRow[]).map(toRow('manual', '/manuals')),
      ];
      /* 種別 (FEATURE_ORDER) → カテゴリ sort_order → カテゴリ名 → 投稿 sort_order (admin の並び替え)
         → タイトル (最終 fallback) の順 */
      const featureRank = new Map(FEATURE_ORDER.map((k, i) => [k, i]));
      all.sort((a, b) => {
        const fa = featureRank.get(a.feature) ?? 99;
        const fb = featureRank.get(b.feature) ?? 99;
        if (fa !== fb) return fa - fb;
        if (a.categorySortOrder !== b.categorySortOrder) return a.categorySortOrder - b.categorySortOrder;
        if (a.categoryName !== b.categoryName) return a.categoryName.localeCompare(b.categoryName, 'ja');
        if (a.postSortOrder !== b.postSortOrder) return a.postSortOrder - b.postSortOrder;
        return a.title.localeCompare(b.title, 'ja');
      });
      setRows(all);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [supabase, scope]);

  /* URL → そのURL を含む投稿の配列 (重複検知) */
  const urlToRows = useMemo(() => {
    const m = new Map<string, { feature: FeatureKey; id: string; title: string; categoryName: string }[]>();
    for (const r of rows) {
      for (const u of r.urls) {
        const arr = m.get(u) ?? [];
        arr.push({ feature: r.feature, id: r.id, title: r.title, categoryName: r.categoryName });
        m.set(u, arr);
      }
    }
    return m;
  }, [rows]);

  /* カテゴリフィルタ用の選択肢 (現フィルタ機能に合致するものだけ) */
  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (featureFilter !== 'all' && r.feature !== featureFilter) continue;
      if (r.categoryId) map.set(r.categoryId, r.categoryName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [rows, featureFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (featureFilter !== 'all' && r.feature !== featureFilter) return false;
      if (categoryFilter !== 'all') {
        if (categoryFilter === '__none__') {
          if (r.categoryId) return false;
        } else if (r.categoryId !== categoryFilter) return false;
      }
      if (publishFilter === 'published' && !r.isPublished) return false;
      if (publishFilter === 'unpublished' && r.isPublished) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, featureFilter, categoryFilter, publishFilter]);

  /* URL 重複のあるユニーク URL 数 */
  const dupUrlCount = useMemo(() => {
    let n = 0;
    for (const arr of urlToRows.values()) if (arr.length >= 2) n++;
    return n;
  }, [urlToRows]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">投稿一覧 (4 機能横断)</h1>
        <p className="text-sm text-brand-gray mt-1">
          {loading ? '読み込み中...' : `${filtered.length} / ${rows.length} 件`}
          {dupUrlCount > 0 && (
            <span className="ml-3 text-amber-700">⚠ 重複URL {dupUrlCount} 件 (赤バッジにカーソルで重複先表示)</span>
          )}
        </p>
      </div>

      <Card>
        <CardContent className="py-3 space-y-3">
          <Input
            placeholder="タイトルで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <label className="space-y-1">
              <span className="text-xs text-brand-gray-light">機能</span>
              <select
                value={featureFilter}
                onChange={(e) => { setFeatureFilter(e.target.value as 'all' | FeatureKey); setCategoryFilter('all'); }}
                className="w-full h-9 rounded-md border border-brand-gray/20 bg-white px-2"
              >
                <option value="all">すべての機能</option>
                {(['announcement', 'compliance', 'training', 'manual'] as FeatureKey[]).map((k) => (
                  <option key={k} value={k}>{FEATURE_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-brand-gray-light">カテゴリ</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full h-9 rounded-md border border-brand-gray/20 bg-white px-2"
              >
                <option value="all">すべてのカテゴリ</option>
                <option value="__none__">(未分類)</option>
                {categoryOptions.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-brand-gray-light">公開状態</span>
              <select
                value={publishFilter}
                onChange={(e) => setPublishFilter(e.target.value as 'all' | 'published' | 'unpublished')}
                className="w-full h-9 rounded-md border border-brand-gray/20 bg-white px-2"
              >
                <option value="all">すべて</option>
                <option value="published">公開のみ</option>
                <option value="unpublished">非公開のみ</option>
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 種別ごとアコーディオン (初期値: 全開) */}
      {!loading && filtered.length === 0 && (
        <Card><CardContent className="py-8 text-center text-brand-gray-light text-sm">該当する投稿がありません</CardContent></Card>
      )}
      <div className="space-y-3">
        {FEATURE_ORDER.map((featureKey) => {
          const featureRows = filtered.filter((r) => r.feature === featureKey);
          if (featureRows.length === 0) return null;
          const isOpen = openFeatures.has(featureKey);
          return (
            <Card key={featureKey}>
              <CardContent className="p-0">
                {/* セクションヘッダー */}
                <button
                  type="button"
                  onClick={() => toggleFeature(featureKey)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-brand-gray/[0.04] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{FEATURE_ICON[featureKey]}</span>
                    <span className="text-sm font-bold">{FEATURE_LABEL[featureKey]}</span>
                    <Badge variant="outline" className={`text-[10px] ${FEATURE_BADGE_CLASS[featureKey]}`}>
                      {featureRows.length} 件
                    </Badge>
                  </div>
                  <span className="text-brand-gray-light text-sm select-none">
                    {isOpen ? '▼' : '▶'}
                  </span>
                </button>

                {isOpen && (
                  <>
                    {/* デスクトップ・タブレット: テーブル表示 (md 以上) */}
                    <div className="hidden md:block overflow-x-auto border-t">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-brand-gray-light bg-brand-gray/[0.03]">
                            <th className="py-2 px-2 whitespace-nowrap">カテゴリ</th>
                            <th className="py-2 px-2 whitespace-nowrap">タイトル</th>
                            <th className="py-2 px-2 whitespace-nowrap">内容</th>
                            <th className="py-2 px-2 whitespace-nowrap">URL</th>
                            <th className="py-2 px-2 whitespace-nowrap text-center">公開</th>
                            <th className="py-2 px-2 whitespace-nowrap">投稿者</th>
                          </tr>
                        </thead>
                        <tbody>
                          {featureRows.map((r) => (
                            <tr key={`${r.feature}::${r.id}`} className="border-b last:border-0 hover:bg-brand-gray/[0.03]">
                              <td className="py-2 px-2 align-top whitespace-nowrap text-xs">{r.categoryName}</td>
                              <td className="py-2 px-2 align-top">
                                <Link href={r.editLink} className="text-brand-blue hover:underline break-words">
                                  {r.title}
                                </Link>
                              </td>
                              <td className="py-2 px-2 align-top max-w-[240px]">
                                {r.textContent ? (
                                  <button
                                    type="button"
                                    className="text-left text-xs text-brand-gray-light hover:text-brand-ink line-clamp-2 underline decoration-dotted"
                                    onClick={() => setContentPreview({ title: r.title, text: r.textContent })}
                                    title="クリックで全文表示"
                                  >
                                    {r.textContent.slice(0, 80)}{r.textContent.length > 80 ? '…' : ''}
                                  </button>
                                ) : (
                                  <span className="text-xs text-brand-gray-light">(本文なし)</span>
                                )}
                              </td>
                              <td className="py-2 px-2 align-top max-w-[240px]">
                                {r.urls.length === 0 ? (
                                  <span className="text-xs text-brand-gray-light">—</span>
                                ) : (
                                  <div className="space-y-1">
                                    {r.urls.map((u) => {
                                      const sameUrlRows = urlToRows.get(u) ?? [];
                                      const others = sameUrlRows.filter((o) => !(o.feature === r.feature && o.id === r.id));
                                      const isDup = others.length > 0;
                                      const tooltip = isDup
                                        ? `他で使用中:\n${others.map((o) => `・[${FEATURE_LABEL[o.feature]}/${o.categoryName}] ${o.title}`).join('\n')}`
                                        : '';
                                      return (
                                        <div key={u} className="flex items-center gap-1.5">
                                          <a
                                            href={u}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[11px] text-brand-blue hover:underline truncate max-w-[200px]"
                                            title={u}
                                          >
                                            {u}
                                          </a>
                                          {isDup && (
                                            <span
                                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 cursor-help shrink-0"
                                              title={tooltip}
                                            >
                                              重複 {sameUrlRows.length}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2 align-top text-center">
                                {r.isPublished
                                  ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]">公開</Badge>
                                  : <Badge variant="outline" className="text-[10px] text-brand-gray-light">非公開</Badge>}
                              </td>
                              <td className="py-2 px-2 align-top whitespace-nowrap text-xs text-brand-gray">
                                {r.creatorName}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* モバイル: カードレイアウト (md 未満) */}
                    <div className="md:hidden border-t divide-y">
                      {featureRows.map((r) => (
                        <div key={`m::${r.feature}::${r.id}`} className="p-3 space-y-2 hover:bg-brand-gray/[0.03]">
                          {/* 1 行目: カテゴリ + 公開バッジ */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-brand-gray-light truncate">{r.categoryName}</span>
                            {r.isPublished
                              ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] shrink-0">公開</Badge>
                              : <Badge variant="outline" className="text-[10px] text-brand-gray-light shrink-0">非公開</Badge>}
                          </div>
                          {/* 2 行目: タイトル */}
                          <Link href={r.editLink} className="block text-sm font-medium text-brand-blue hover:underline break-words leading-snug">
                            {r.title}
                          </Link>
                          {/* 内容 */}
                          {r.textContent && (
                            <button
                              type="button"
                              className="block text-left text-[11px] text-brand-gray-light hover:text-brand-ink line-clamp-2 underline decoration-dotted"
                              onClick={() => setContentPreview({ title: r.title, text: r.textContent })}
                            >
                              {r.textContent.slice(0, 80)}{r.textContent.length > 80 ? '…' : ''}
                            </button>
                          )}
                          {/* URL */}
                          {r.urls.length > 0 && (
                            <div className="space-y-1">
                              {r.urls.map((u) => {
                                const sameUrlRows = urlToRows.get(u) ?? [];
                                const others = sameUrlRows.filter((o) => !(o.feature === r.feature && o.id === r.id));
                                const isDup = others.length > 0;
                                const tooltip = isDup
                                  ? `他で使用中:\n${others.map((o) => `・[${FEATURE_LABEL[o.feature]}/${o.categoryName}] ${o.title}`).join('\n')}`
                                  : '';
                                return (
                                  <div key={u} className="flex items-center gap-1.5 flex-wrap">
                                    <a
                                      href={u}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[11px] text-brand-blue hover:underline break-all"
                                      title={u}
                                    >
                                      {u}
                                    </a>
                                    {isDup && (
                                      <span
                                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 cursor-help shrink-0"
                                        title={tooltip}
                                      >
                                        重複 {sameUrlRows.length}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {/* 投稿者 */}
                          <p className="text-[10px] text-brand-gray-light">投稿者: {r.creatorName}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 内容ポップ: クリックで全文表示 */}
      <Dialog open={contentPreview !== null} onOpenChange={(o) => { if (!o) setContentPreview(null); }}>
        <DialogContent className="w-[92vw] sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{contentPreview?.title}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto text-sm whitespace-pre-wrap leading-relaxed">
            {contentPreview?.text}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
