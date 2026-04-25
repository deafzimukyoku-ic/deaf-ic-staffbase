'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CategoryBadge } from '@/components/admin/CategorySelect';
import { applyScopeFilter } from '@/components/admin/FacilityScopeSelector';
import { NewBadge } from '@/components/admin/NewBadge';
import { BlockRenderer } from '@/components/admin/BlockRenderer';
import { ItemGridCard, blocksToExcerpt, blocksHaveMedia } from '@/components/employee/ItemGridCard';
import { logView } from '@/lib/view-log';
import { toast } from 'sonner';
import type { Category, TargetType } from '@/lib/types';

interface ComplianceDoc {
  id: string;
  title: string;
  content: string;
  admin_comment: string | null;
  updated_at: string;
  category_id: string | null;
  target_type: TargetType;
  target_facility_ids: string[];
  target_position_ids: string[];
}

export default function MyCompliancePage() {
  const [docs, setDocs] = useState<ComplianceDoc[]>([]);
  const [ackMap, setAckMap] = useState<Record<string, boolean>>({});
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackLoading, setAckLoading] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [employeeInfo, setEmployeeInfo] = useState<{ facility_id: string | null, position_id: string | null } | null>(null);
  const supabase = createClient();

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me, error: meError } = await supabase
        .from('employees')
        .select('id, tenant_id, facility_id, position_id')
        .eq('auth_user_id', user.id)
        .single();

      if (meError || !me) {
        console.error('Error fetching employee:', meError);
        setLoading(false);
        return;
      }
      setEmployeeId(me.id);
      setTenantId(me.tenant_id);

      setEmployeeInfo({
        facility_id: me.facility_id,
        position_id: me.position_id,
      });

      // 全遵守事項を取得
      const { data: compDocs } = await supabase
        .from('compliance_documents')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });

      // フィルタリング（施設・役職） — migration 115 で部署フィルタ廃止
      const docList = (compDocs || []).filter(doc => {
        if (doc.target_type === 'facility' && !doc.target_facility_ids.includes(me.facility_id || '')) return false;
        if (doc.target_position_ids && doc.target_position_ids.length > 0) {
          if (!doc.target_position_ids.includes(me.position_id || '')) return false;
        }
        return true;
      }) as ComplianceDoc[];

      setDocs(docList);

      // 各文書の現バージョンに対する acknowledgment をバッチ取得（N+1 回避）
      // 旧実装は docList.length 回の往復で 49 件投入時に重かった
      const newAckMap: Record<string, boolean> = {};
      if (docList.length > 0) {
        const docIds = docList.map((d) => d.id);
        const { data: acks } = await supabase
          .from('compliance_acknowledgments')
          .select('compliance_document_id, document_updated_at')
          .eq('employee_id', me.id)
          .in('compliance_document_id', docIds);

        // 文書の現バージョン（updated_at）と一致する確認のみ有効
        const docVersionMap = new Map(docList.map((d) => [d.id, d.updated_at]));
        for (const ack of acks ?? []) {
          const docVer = docVersionMap.get(ack.compliance_document_id);
          if (docVer && ack.document_updated_at === docVer) {
            newAckMap[ack.compliance_document_id] = true;
          }
        }
      }
      setAckMap(newAckMap);

      try {
        const catRes = await fetch('/api/categories?type=compliance');
        if (catRes.ok) setCategories(await catRes.json());
      } catch (e) {
        console.error('Error fetching categories:', e);
      }

      setLoading(false);
    } catch (e) {
      console.error('Unexpected error in MyCompliancePage:', e);
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleAcknowledge(doc: ComplianceDoc) {
    if (!employeeId) return;
    setAckLoading(doc.id);

    const { error } = await supabase
      .from('compliance_acknowledgments')
      .insert({
        employee_id: employeeId,
        compliance_document_id: doc.id,
        document_updated_at: doc.updated_at,
      });

    if (error) {
      toast.error('確認の記録に失敗しました');
      setAckLoading(null);
      return;
    }

    setAckMap((prev) => ({ ...prev, [doc.id]: true }));
    toast.success('遵守事項を確認しました');
    setAckLoading(null);
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  if (docs.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">遵守事項</h1>
        <p className="text-diletto-gray-light">遵守事項はまだ登録されていません</p>
      </div>
    );
  }

  const totalCount = docs.length;
  const acknowledgedCount = docs.filter((d) => ackMap[d.id]).length;
  const unacknowledgedCount = totalCount - acknowledgedCount;
  const progressPercent = totalCount > 0 ? Math.round((acknowledgedCount / totalCount) * 100) : 0;

  // カテゴリごとの統計
  const catStats = categories.map(cat => {
    const catDocs = docs.filter(d => d.category_id === cat.id);
    const unread = catDocs.filter(d => !ackMap[d.id]).length;
    return { ...cat, unread };
  });

  // カテゴリ未設定のドキュメント
  const uncategorizedDocs = docs.filter(d => !d.category_id);
  const uncategorizedUnread = uncategorizedDocs.filter(d => !ackMap[d.id]).length;

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-diletto-ink">遵守事項</h1>
            <p className="text-sm text-diletto-gray mt-1">カテゴリを選択して確認してください</p>
          </div>
          {unacknowledgedCount > 0 && (
            <Badge className="bg-diletto-red text-white border-none shadow-sm flex gap-2 items-center h-8 px-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              未確認 {unacknowledgedCount}件
            </Badge>
          )}
        </div>

        {/* 進捗バー (my/dashboard を踏襲) */}
        <div className="mb-8 mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-diletto-gray">全体の進捗 — {acknowledgedCount}/{totalCount} 完了</p>
            <p className="text-sm font-semibold text-diletto-ink">{progressPercent}%</p>
          </div>
          <div className="h-3 w-full rounded-full bg-diletto-beige overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${progressPercent === 100 ? 'bg-diletto-green' : 'bg-diletto-blue'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {catStats.map((cat) => {
            const catDocs = docs.filter(d => d.category_id === cat.id);
            const catTotal = catDocs.length;
            const catDone = catDocs.filter(d => ackMap[d.id]).length;
            const catPct = catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0;

            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[160px] text-left"
              >
                <div
                  className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity"
                  style={{ backgroundColor: cat.color }}
                />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '📜'}
                  </span>
                  {cat.unread > 0 && (
                    <span className="h-5 min-w-5 px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                      {cat.unread}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <span className="text-sm font-bold text-diletto-ink block truncate mb-1">
                    {cat.name}
                  </span>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-diletto-gray">
                      {catDone}/{catTotal} 完了
                    </span>
                    {catPct === 100 && <Badge variant="success" className="text-[9px] py-0 h-4">完了</Badge>}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-diletto-beige overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${catPct === 100 ? 'bg-diletto-green' : 'bg-diletto-blue'}`}
                      style={{ width: `${catPct}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}

          {uncategorizedDocs.length > 0 && (
            <button
              onClick={() => setSelectedCategory({ id: 'none', name: 'その他', icon: '📎', color: '#94a3b8' } as any)}
              className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[160px] text-left"
            >
              <div className="flex justify-between items-start mb-auto relative">
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300">📎</span>
                {uncategorizedUnread > 0 && (
                  <span className="h-5 min-w-5 px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                    {uncategorizedUnread}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="text-sm font-bold text-diletto-ink block mb-1">その他</span>
                <span className="text-[10px] text-diletto-gray block mb-2">{uncategorizedDocs.length} 項目</span>
                <div className="h-1.5 w-full rounded-full bg-diletto-beige overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-diletto-gray-light/30`}
                    style={{ width: `${Math.round(((uncategorizedDocs.length - uncategorizedUnread) / uncategorizedDocs.length) * 100)}%` }}
                  />
                </div>
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  const categoryDocs = selectedCategory.id === 'none'
    ? uncategorizedDocs
    : docs.filter(d => d.category_id === selectedCategory.id);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedCategory(null)}
          className="text-diletto-gray-light hover:text-diletto-ink"
        >
          ← 戻る
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xl">{selectedCategory.icon}</span>
          <h1 className="text-2xl font-bold">{selectedCategory.name}</h1>
        </div>
      </div>

      <GridView
        docs={categoryDocs}
        onView={(id) => {
          if (tenantId && employeeId) {
            logView(supabase, 'compliance_view_logs', { tenant_id: tenantId, employee_id: employeeId, item_id: id });
          }
        }}
        ackMap={ackMap}
        ackLoading={ackLoading}
        onAcknowledge={handleAcknowledge}
      />
    </div>
  );
}

// ===== Plan C: カードグリッド + 詳細モーダル =====
function GridView({ docs, ackMap, ackLoading, onAcknowledge, onView }: {
  docs: ComplianceDoc[];
  ackMap: Record<string, boolean>;
  ackLoading: string | null;
  onAcknowledge: (doc: ComplianceDoc) => void;
  onView: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (docs.length === 0) {
    return <p className="text-center py-20 text-diletto-gray-light">このカテゴリのドキュメントはありません</p>;
  }

  const openDoc = openId ? docs.find((d) => d.id === openId) : null;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
        {docs.map((doc) => (
          <ItemGridCard
            key={doc.id}
            title={doc.title}
            excerpt={blocksToExcerpt((doc as any).content_blocks, doc.content)}
            createdAt={doc.created_at || doc.updated_at}
            acknowledged={!!ackMap[doc.id]}
            ackLabel="同意済"
            pendingLabel="未同意"
            hasMedia={blocksHaveMedia((doc as any).content_blocks)}
            onClick={() => {
              setOpenId(doc.id);
              onView(doc.id);
            }}
          />
        ))}
      </div>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="!max-w-6xl sm:!max-w-6xl max-h-[90vh] overflow-y-auto">
          {openDoc && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <DialogTitle className="text-lg font-bold">{openDoc.title || '（無題）'}</DialogTitle>
                    <NewBadge createdAt={openDoc.created_at || openDoc.updated_at} />
                  </div>
                  {ackMap[openDoc.id] ? (
                    <Badge className="bg-diletto-green/10 text-diletto-green border-none">同意済</Badge>
                  ) : (
                    <Badge className="bg-diletto-red/10 text-diletto-red border-none">未同意</Badge>
                  )}
                </div>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                <div className="border border-diletto-gray/10 rounded-md p-5 bg-white shadow-inner min-h-[120px]">
                  <BlockRenderer blocks={(openDoc as any).content_blocks || []} fallbackText={openDoc.content} />
                </div>

                {openDoc.admin_comment && (
                  <div className="text-xs text-diletto-gray-light bg-diletto-gray/5 p-3 rounded-md flex gap-2 italic">
                    <span>💡</span>
                    {openDoc.admin_comment}
                  </div>
                )}

                {!ackMap[openDoc.id] && (
                  <div className="space-y-2">
                    <p className="text-xs text-diletto-gray-light text-center">
                      下記ボタンを押すことで「内容を確認し、遵守して勤務に取り組むこと」に同意したとみなされます
                    </p>
                    <Button
                      onClick={() => onAcknowledge(openDoc)}
                      disabled={ackLoading === openDoc.id}
                      className="w-full h-12 bg-diletto-blue hover:bg-diletto-ink text-white font-bold rounded-md shadow-lg shadow-diletto-blue/10 transition-all active:scale-[0.98]"
                    >
                      {ackLoading === openDoc.id ? '処理中...' : '✓ 内容を確認し、遵守して勤務に取り組むことに同意します'}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
