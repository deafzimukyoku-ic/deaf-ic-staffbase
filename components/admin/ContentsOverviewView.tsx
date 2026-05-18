'use client';

/* 4 機能 (お知らせ / 遵守事項 / 研修 / 業務マニュアル) を横断する投稿一覧。
   - admin / manager 両方で同じ UI
   - タイトル検索 + 機能 / カテゴリ / 公開状態 フィルタ
   - タイトル完全一致 (正規化: 前後空白除去 + 小文字化) 行のハイライト + 「重複」バッジ
   - 各行から該当機能の管理ページに遷移して直接編集 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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

interface Row {
  feature: FeatureKey;
  id: string;
  title: string;
  categoryName: string | null;
  isPublished: boolean;
  createdAt: string;
  editorName: string;
  editLink: string;
}

interface Props {
  scope: 'admin' | 'manager';
}

/* 重複判定用のタイトル正規化 (前後空白除去 + 全角→半角空白 + 連続空白 1 つ + 小文字化) */
function normalize(title: string): string {
  return title.replace(/[　\s]+/g, ' ').trim().toLowerCase();
}

export function ContentsOverviewView({ scope }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  /* フィルタ */
  const [query, setQuery] = useState('');
  const [featureFilter, setFeatureFilter] = useState<'all' | FeatureKey>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all'); /* category_id or 'all' / '__none__' */
  const [publishFilter, setPublishFilter] = useState<'all' | 'published' | 'unpublished'>('all');

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
        supabase.from('announcements').select('id, title, category_id, is_published, created_at, updated_at, created_by, updated_by').eq('tenant_id', tenantId),
        supabase.from('compliance_documents').select('id, title, category_id, is_published, created_at, updated_at, created_by, updated_by').eq('tenant_id', tenantId),
        supabase.from('trainings').select('id, title, category_id, is_published, created_at, updated_at, created_by, updated_by').eq('tenant_id', tenantId),
        supabase.from('manuals').select('id, title, category_id, is_published, created_at, updated_at, created_by, updated_by').eq('tenant_id', tenantId),
        supabase.from('categories').select('id, name, type').eq('tenant_id', tenantId),
        supabase.from('employees').select('id, last_name, first_name').eq('tenant_id', tenantId),
      ]);

      const catMap = new Map<string, string>();
      for (const c of (cats.data ?? []) as Array<{ id: string; name: string }>) {
        catMap.set(c.id, c.name);
      }
      const empMap = new Map<string, string>();
      for (const e of (emps.data ?? []) as Array<{ id: string; last_name: string | null; first_name: string | null }>) {
        empMap.set(e.id, `${e.last_name ?? ''} ${e.first_name ?? ''}`.trim() || '(名前未設定)');
      }

      function toRow(feature: FeatureKey, basePath: string) {
        return (r: { id: string; title: string | null; category_id: string | null; is_published: boolean; created_at: string; updated_at: string | null; created_by: string | null; updated_by: string | null }): Row => {
          const editorId = r.updated_by ?? r.created_by;
          return {
            feature,
            id: r.id,
            title: r.title ?? '(無題)',
            categoryName: r.category_id ? (catMap.get(r.category_id) ?? '(未分類カテゴリ)') : null,
            isPublished: r.is_published,
            createdAt: r.created_at,
            editorName: editorId ? (empMap.get(editorId) ?? '(削除済)') : '(不明)',
            editLink: `${base}${basePath}`,
          };
        };
      }

      const all: Row[] = [
        ...((ann.data ?? []) as Parameters<ReturnType<typeof toRow>>[0][]).map(toRow('announcement', '/announcements')),
        ...((comp.data ?? []) as Parameters<ReturnType<typeof toRow>>[0][]).map(toRow('compliance', '/compliance')),
        ...((train.data ?? []) as Parameters<ReturnType<typeof toRow>>[0][]).map(toRow('training', '/trainings')),
        ...((man.data ?? []) as Parameters<ReturnType<typeof toRow>>[0][]).map(toRow('manual', '/manuals')),
      ];
      all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRows(all);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [supabase, scope]);

  /* タイトル完全一致グループ (重複判定) */
  const dupCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = normalize(r.title);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  /* カテゴリフィルタの選択肢 (フィルタ中の機能に応じて) */
  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (featureFilter !== 'all' && r.feature !== featureFilter) continue;
      if (!r.categoryName) continue;
      const key = `${r.feature}::${r.categoryName}`;
      seen.set(key, r.categoryName);
    }
    return Array.from(new Set(seen.values())).sort();
  }, [rows, featureFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (featureFilter !== 'all' && r.feature !== featureFilter) return false;
      if (categoryFilter !== 'all') {
        if (categoryFilter === '__none__') {
          if (r.categoryName) return false;
        } else if (r.categoryName !== categoryFilter) return false;
      }
      if (publishFilter === 'published' && !r.isPublished) return false;
      if (publishFilter === 'unpublished' && r.isPublished) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, featureFilter, categoryFilter, publishFilter]);

  const dupTotal = useMemo(() => {
    return Array.from(dupCounts.values()).filter((n) => n >= 2).length;
  }, [dupCounts]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">投稿一覧 (4 機能横断)</h1>
        <p className="text-sm text-diletto-gray mt-1">
          {loading ? '読み込み中...' : `${filtered.length} / ${rows.length} 件`}
          {dupTotal > 0 && (
            <span className="ml-3 text-amber-700">⚠ タイトル重複 {dupTotal} 件 (黄色ハイライト)</span>
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
              <span className="text-xs text-diletto-gray-light">機能</span>
              <select
                value={featureFilter}
                onChange={(e) => { setFeatureFilter(e.target.value as 'all' | FeatureKey); setCategoryFilter('all'); }}
                className="w-full h-9 rounded-md border border-diletto-gray/20 bg-white px-2"
              >
                <option value="all">すべての機能</option>
                {(['announcement', 'compliance', 'training', 'manual'] as FeatureKey[]).map((k) => (
                  <option key={k} value={k}>{FEATURE_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-diletto-gray-light">カテゴリ</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full h-9 rounded-md border border-diletto-gray/20 bg-white px-2"
              >
                <option value="all">すべてのカテゴリ</option>
                <option value="__none__">(未分類)</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-diletto-gray-light">公開状態</span>
              <select
                value={publishFilter}
                onChange={(e) => setPublishFilter(e.target.value as 'all' | 'published' | 'unpublished')}
                className="w-full h-9 rounded-md border border-diletto-gray/20 bg-white px-2"
              >
                <option value="all">すべて</option>
                <option value="published">公開のみ</option>
                <option value="unpublished">非公開のみ</option>
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-diletto-gray-light">
                  <th className="py-2 px-2 whitespace-nowrap">タイトル</th>
                  <th className="py-2 px-2 whitespace-nowrap">機能</th>
                  <th className="py-2 px-2 whitespace-nowrap">カテゴリ</th>
                  <th className="py-2 px-2 whitespace-nowrap text-center">公開</th>
                  <th className="py-2 px-2 whitespace-nowrap">投稿日</th>
                  <th className="py-2 px-2 whitespace-nowrap">編集者</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const dup = dupCounts.get(normalize(r.title)) ?? 1;
                  return (
                    <tr
                      key={`${r.feature}::${r.id}`}
                      className={
                        'border-b last:border-0 ' +
                        (dup >= 2 ? 'bg-amber-50/60' : 'hover:bg-diletto-gray/[0.03]')
                      }
                    >
                      <td className="py-2 px-2 align-top">
                        <Link href={r.editLink} className="text-diletto-blue hover:underline">
                          {r.title}
                        </Link>
                        {dup >= 2 && (
                          <Badge variant="outline" className="ml-2 text-[10px] border-amber-400 text-amber-800">
                            重複 {dup}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 px-2 align-top">
                        <Badge variant="outline" className={`text-[11px] ${FEATURE_BADGE_CLASS[r.feature]}`}>
                          {FEATURE_LABEL[r.feature]}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 align-top whitespace-nowrap">{r.categoryName ?? <span className="text-diletto-gray-light">(未分類)</span>}</td>
                      <td className="py-2 px-2 align-top text-center">
                        {r.isPublished
                          ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]">公開</Badge>
                          : <Badge variant="outline" className="text-[10px] text-diletto-gray-light">非公開</Badge>}
                      </td>
                      <td className="py-2 px-2 align-top whitespace-nowrap text-diletto-gray-light text-xs">
                        {new Date(r.createdAt).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="py-2 px-2 align-top whitespace-nowrap text-xs">{r.editorName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <p className="text-center py-8 text-diletto-gray-light text-sm">該当する投稿がありません</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
