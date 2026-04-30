'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Manual, Category } from '@/lib/types';
import { NewBadge } from '@/components/admin/NewBadge';
import { BlockRenderer } from '@/components/admin/BlockRenderer';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ItemGridCard, blocksToExcerpt, blocksHaveMedia } from '@/components/employee/ItemGridCard';
import { fetchMyViewSummary, logView, type ViewSummary } from '@/lib/view-log';
import { ViewConfirmButton } from '@/components/employee/ViewConfirmButton';
import { fetchMyFacilityIds, facilityTargetsMatchMine } from '@/lib/multi-facility';

interface ManualWithRead extends Manual {
  isRead: boolean;
}

export default function MyManualsPage() {
  const [items, setItems] = useState<ManualWithRead[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [viewSummaries, setViewSummaries] = useState<Map<string, ViewSummary>>(new Map());
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      try {
        const { data: me, error: meError } = await supabase
          .from('employees')
          .select('id, tenant_id, facility_id, position_id')
          .eq('auth_user_id', user.id)
          .single();

        if (meError || !me) {
          setLoading(false);
          return;
        }
        setTenantId(me.tenant_id);
        setEmployeeId(me.id);

        const { data: manuals } = await supabase
          .from('manuals')
          .select('*')
          .eq('tenant_id', me.tenant_id)
          .order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });

        const { data: reads } = await supabase
          .from('manual_reads')
          .select('manual_id')
          .eq('employee_id', me.id);

        const readSet = new Set((reads || []).map((r) => r.manual_id));

        // 自分の所属 facility 集合（主所属 + 兼任先 / migration 130）
        const myFacilityIds = await fetchMyFacilityIds(supabase, me.id, me.facility_id);

        // migration 130: 兼任先の facility 配信も届くように、target_facility_ids ∩ myFacilityIds で判定
        const docList = (manuals || []).filter((m: any) => {
          if (m.target_type === 'facility' && !facilityTargetsMatchMine(m.target_facility_ids, myFacilityIds)) return false;
          if (m.target_position_ids && m.target_position_ids.length > 0) {
            if (!m.target_position_ids.includes(me.position_id || '')) return false;
          }
          return true;
        }) as Manual[];

        setItems(docList.map((m) => ({ ...m, isRead: readSet.has(m.id) })));

        /* 確認ボタン履歴の集計 */
        const vs = await fetchMyViewSummary(supabase, 'manual_view_logs', me.id);
        setViewSummaries(vs);

        try {
          const catRes = await fetch('/api/categories?type=manual');
          if (catRes.ok) setCategories(await catRes.json());
        } catch {}

        setLoading(false);
      } catch {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function markRead(manualId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: me } = await supabase.from('employees').select('id, tenant_id').eq('auth_user_id', user.id).single();
    if (!me) return;
    await supabase.from('manual_reads').insert({ manual_id: manualId, employee_id: me.id });
    setItems((prev) => prev.map((i) => i.id === manualId ? { ...i, isRead: true } : i));
    /* 既読化 = 1 回目の確認とカウント。view_logs にも 1 行追加。
       同セッション中は ViewConfirmButton 非表示なので「2 重ボタン」問題は起きない。 */
    await logView(supabase, 'manual_view_logs', { tenant_id: me.tenant_id, employee_id: me.id, item_id: manualId });
    setViewSummaries((prev) => {
      const next = new Map(prev);
      const existing = next.get(manualId);
      next.set(manualId, { count: (existing?.count ?? 0) + 1, lastAt: new Date().toISOString() });
      return next;
    });
  }

  async function openPdf(path: string) {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60 * 10);
    if (error || !data) return;
    window.open(data.signedUrl, '_blank');
  }

  const unreadCount = items.filter((i) => !i.isRead).length;

  const catStats = categories.map(cat => {
    const catItems = items.filter(i => i.category_id === cat.id);
    const unread = catItems.filter(i => !i.isRead).length;
    return { ...cat, unread, total: catItems.length };
  });

  const uncategorizedItems = items.filter(i => !i.category_id);
  const uncategorizedUnread = uncategorizedItems.filter(i => !i.isRead).length;

  const totalCount = items.length;
  const readCount = items.filter((i) => i.isRead).length;
  const progressPercent = totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0;

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /></div>;

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-diletto-ink">業務マニュアル</h1>
            <p className="text-sm text-diletto-gray mt-1">カテゴリを選択して確認してください</p>
          </div>
          {unreadCount > 0 && (
            <Badge className="bg-diletto-red text-white border-none shadow-sm flex gap-2 items-center h-8 px-3">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              未読 {unreadCount}件
            </Badge>
          )}
        </div>

        <div className="mb-8 mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-diletto-gray">既読状況 — {readCount}/{totalCount} 既読</p>
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
            const catItems = items.filter(i => i.category_id === cat.id);
            const catTotal = catItems.length;
            const catRead = catItems.filter(i => i.isRead).length;
            const catPct = catTotal > 0 ? Math.round((catRead / catTotal) * 100) : 0;

            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[160px] text-left"
              >
                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-4xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '📖'}
                  </span>
                  {cat.unread > 0 && (
                    <span className="h-5 min-w-5 px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                      {cat.unread}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="text-sm font-bold text-diletto-ink block truncate mb-1">{cat.name}</span>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-diletto-gray">{catRead}/{catTotal} 既読</span>
                    {catPct === 100 && <Badge variant="success" className="text-[9px] py-0 h-4">完了</Badge>}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-diletto-beige overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${catPct === 100 ? 'bg-diletto-green' : 'bg-diletto-blue'}`} style={{ width: `${catPct}%` }} />
                  </div>
                </div>
              </button>
            );
          })}

          {uncategorizedItems.length > 0 && (
            <button
              onClick={() => setSelectedCategory({ id: 'none', name: 'その他', icon: '📎', color: '#94a3b8' } as any)}
              className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[160px] text-left"
            >
              <div className="flex justify-between items-start mb-auto relative">
                <span className="text-4xl group-hover:scale-110 transition-transform duration-300">📎</span>
                {uncategorizedUnread > 0 && (
                  <span className="h-5 min-w-5 px-1 rounded-full bg-diletto-red text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                    {uncategorizedUnread}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="text-sm font-bold text-diletto-ink block mb-1">その他</span>
                <span className="text-[10px] text-diletto-gray block mb-2">{uncategorizedItems.length} 件</span>
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  const visible = selectedCategory.id === 'none'
    ? uncategorizedItems
    : items.filter(i => i.category_id === selectedCategory.id);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedCategory(null)}
          className="text-diletto-gray-light hover:text-diletto-ink px-0"
        >
          ← カテゴリ一覧へ
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xl">{selectedCategory.icon}</span>
          <h1 className="text-2xl font-bold">{selectedCategory.name}</h1>
        </div>
      </div>

      <ManualsGridView
        items={visible}
        onMarkRead={markRead}
        onOpenPdf={openPdf}
        tenantId={tenantId}
        employeeId={employeeId}
        viewSummaries={viewSummaries}
        onViewConfirmed={(id, count, viewedAt) => {
          setViewSummaries((prev) => {
            const next = new Map(prev);
            next.set(id, { count, lastAt: viewedAt });
            return next;
          });
        }}
      />
    </div>
  );
}

function ManualsGridView({ items, onMarkRead, onOpenPdf, tenantId, employeeId, viewSummaries, onViewConfirmed }: {
  items: ManualWithRead[];
  onMarkRead: (id: string) => void;
  onOpenPdf: (path: string) => void;
  tenantId: string | null;
  employeeId: string | null;
  viewSummaries: Map<string, ViewSummary>;
  onViewConfirmed: (id: string, count: number, viewedAt: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  /* モーダルを開いた瞬間の isRead 状態を記録（同セッション中は変化しない） */
  const [wasReadAtOpen, setWasReadAtOpen] = useState<boolean>(false);
  const open = openId ? items.find((i) => i.id === openId) : null;

  if (items.length === 0) {
    return <p className="text-center py-20 text-diletto-gray-light">このカテゴリの業務マニュアルはありません</p>;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
        {items.map((m) => (
          <ItemGridCard
            key={m.id}
            title={m.title}
            excerpt={blocksToExcerpt(m.content_blocks, m.body)}
            createdAt={m.created_at}
            acknowledged={m.isRead}
            ackLabel="既読"
            pendingLabel="未読"
            hasMedia={blocksHaveMedia(m.content_blocks) || !!m.pdf_storage_path}
            onClick={() => {
              setWasReadAtOpen(m.isRead);
              setOpenId(m.id);
              /* 既読 / 確認カウント は明示ボタンのみ、自動カウントは廃止 */
            }}
          />
        ))}
      </div>

      <Dialog
        open={!!openId}
        onOpenChange={(o) => {
          if (o) return;
          // 閉じる際: 未読のままなら警告して既読を促す
          if (open && !open.isRead) {
            const ok = confirm('既読ボタンを押さないと既読とみなされません。\nこのまま閉じますか？');
            if (!ok) return;
          }
          setOpenId(null);
        }}
      >
        <DialogContent className="!max-w-6xl sm:!max-w-6xl max-h-[90vh] overflow-y-auto">
          {open && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <DialogTitle className="text-lg font-bold">{open.title}</DialogTitle>
                    <NewBadge createdAt={open.created_at} />
                    {open.pdf_storage_path && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">📄 PDF</span>
                    )}
                  </div>
                  {open.isRead ? (
                    <Badge variant="outline" className="text-[10px] shrink-0 border-diletto-gray/20 text-diletto-gray">既読</Badge>
                  ) : (
                    <Badge className="bg-diletto-red text-white text-[10px] shrink-0 border-none">未読</Badge>
                  )}
                </div>
              </DialogHeader>
              <div className="pt-2">
                <BlockRenderer blocks={open.content_blocks || []} fallbackText={open.body || null} />
              </div>
              {open.pdf_storage_path && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-8 text-xs"
                  onClick={() => onOpenPdf(open.pdf_storage_path!)}
                >
                  📄 PDFを開く
                </Button>
              )}
              <p className="text-[10px] text-diletto-gray-light mt-4 pt-3 border-t border-diletto-gray/5">
                {new Date(open.created_at).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              {/* 既読ボタン: 未読時のみ表示。押すと既読化 + モーダルを閉じる。 */}
              <div className="mt-4 pt-3 border-t border-diletto-gray/10 flex items-center justify-between gap-3">
                {!open.isRead ? (
                  <p className="text-xs text-diletto-red font-medium">
                    ⚠ 既読ボタンを押さないと既読とみなされません
                  </p>
                ) : (
                  <p className="text-xs text-diletto-green font-medium">✓ 既読済み</p>
                )}
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (open && !open.isRead) {
                        const ok = confirm('既読ボタンを押さないと既読とみなされません。\nこのまま閉じますか？');
                        if (!ok) return;
                      }
                      setOpenId(null);
                    }}
                  >
                    閉じる
                  </Button>
                  {!open.isRead && (
                    <Button
                      onClick={() => {
                        onMarkRead(open.id);
                        setOpenId(null);
                      }}
                      className="bg-diletto-blue hover:bg-diletto-blue/90 text-white"
                    >
                      ✓ 既読にする
                    </Button>
                  )}
                </div>
              </div>
              {/* 「✓ 確認しました（N 回目）」: 開いた瞬間 既読済みだったときだけ表示。
                  1 回目（未読 → 既読化 → カウント 1）は同セッション中ボタン非表示、
                  閉じて再度開くと「2 回目」として表示される。 */}
              {tenantId && employeeId && wasReadAtOpen && (
                <div className="pt-3 border-t border-diletto-gray/10 mt-3">
                  <ViewConfirmButton
                    table="manual_view_logs"
                    tenantId={tenantId}
                    employeeId={employeeId}
                    itemId={open.id}
                    initialSummary={viewSummaries.get(open.id)}
                    onConfirmed={(count, viewedAt) => onViewConfirmed(open.id, count, viewedAt)}
                  />
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
