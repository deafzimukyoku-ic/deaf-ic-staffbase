'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CategorySelect, CategoryBadge } from '@/components/admin/CategorySelect';
import { CategoryManagerModal } from '@/components/admin/CategoryManagerModal';
import { NewBadge } from '@/components/admin/NewBadge';
import { PersonInline } from '@/components/admin/PersonInline';
import { ReorderButtons } from '@/components/admin/ReorderButtons';
import { nextSortOrder } from '@/lib/sort-helpers';
import { AttributeTargetSelector, TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { FacilityScopeSelector, TargetScopeBadge } from '@/components/admin/FacilityScopeSelector';
import { BlockEditor, type ContentBlock } from '@/components/admin/BlockEditor';
import { PublishToggleButton } from '@/components/admin/PublishToggleButton';
import { BulkPublishButtons } from '@/components/admin/BulkPublishButtons';
import { enqueueNotification } from '@/lib/notifications/queue';
import { toast } from 'sonner';
import type { Announcement, Category, Facility, TargetType, Position } from '@/lib/types';

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    category_id: string | null;
    target_type: TargetType;
    target_facility_ids: string[];
    target_position_ids: string[];
  }>({ title: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const supabase = createClient();

  async function reloadAnnouncements(tid: string) {
    const { data } = await supabase
      .from('announcements')
      .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
      .eq('tenant_id', tid)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    setAnnouncements((data as Announcement[]) || []);
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;
      setTenantId(me.tenant_id);

      await reloadAnnouncements(me.tenant_id);

      const catRes = await fetch('/api/categories?type=announcement');
      if (catRes.ok) setCategories(await catRes.json());

      const { data: facData } = await supabase
        .from('facilities')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .order('created_at');
      setFacilities((facData as Facility[]) || []);

      const { data: posData } = await supabase
        .from('positions')
        .select('*')
        .eq('tenant_id', me.tenant_id)
        .order('display_order');
      setPositions((posData as Position[]) || []);

      setLoading(false);
    }
    load();
  }, []);

  async function handleCreate() {
    if (!tenantId || !form.title.trim()) return;
    if (blocks.length === 0) {
      toast.error('コンテンツを1ブロック以上追加してください');
      return;
    }
    if (form.target_type === 'facility' && form.target_facility_ids.length === 0) {
      toast.error('配信対象の施設を1つ以上選択してください');
      return;
    }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from('employees').select('id').eq('auth_user_id', user?.id).single();

    const nextOrder = await nextSortOrder(supabase, 'announcements', tenantId);
    const insertPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      title: form.title.trim(),
      body: '',
      content_blocks: blocks,
      category_id: form.category_id,
      target_type: form.target_type,
      target_facility_ids: form.target_facility_ids,
      target_position_ids: form.target_position_ids,
      created_by: me?.id,
      updated_by: me?.id,
    };
    if (nextOrder !== null) insertPayload.sort_order = nextOrder;
    const { data, error } = await supabase
      .from('announcements')
      .insert(insertPayload)
      .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
      .single();

    if (error) { toast.error('投稿に失敗しました'); setSaving(false); return; }

    await reloadAnnouncements(tenantId);
    setDialogOpen(false);
    setForm({ title: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
    setBlocks([]);
    await enqueueNotification('announcement', (data as Announcement).id);
    toast.success('お知らせを投稿しました。2時間後に対象社員へメール通知されます。');
    setSaving(false);
  }

  const catMap = new Map(categories.map(c => [c.id, c]));

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  const uncategorizedDocs = announcements.filter(d => !d.category_id);

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">お知らせ</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <BulkPublishButtons
              table="announcements"
              items={announcements.map((a) => ({ id: a.id, is_published: a.is_published ?? true }))}
              scopeLabel="全体"
              onChanged={() => tenantId && reloadAnnouncements(tenantId)}
            />
            <CategoryManagerModal type="announcement" />
          </div>
        </div>

        <p className="text-sm text-diletto-gray mb-6">カテゴリを選択してお知らせを確認・修正してください。新規投稿はカテゴリを開いて行います。</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {categories.map((cat) => {
            const catDocs = announcements.filter(d => d.category_id === cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
              >
                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '📢'}
                  </span>
                </div>
                <div className="relative">
                  <span className="text-sm font-bold text-diletto-ink block truncate mb-1">{cat.name}</span>
                  <span className="text-[10px] text-diletto-gray">{catDocs.length} 項目</span>
                </div>
              </button>
            );
          })}

          {uncategorizedDocs.length > 0 && (
            <button
              onClick={() => setSelectedCategory({ id: 'none', name: 'その他', icon: '📎', color: '#94a3b8' } as any)}
              className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
            >
              <div className="flex justify-between items-start mb-auto relative">
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300">📎</span>
              </div>
              <div className="relative">
                <span className="text-sm font-bold text-diletto-ink block mb-1">その他</span>
                <span className="text-[10px] text-diletto-gray block">{uncategorizedDocs.length} 項目</span>
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  const filtered = selectedCategory.id === 'none'
    ? uncategorizedDocs
    : announcements.filter(d => d.category_id === selectedCategory.id);

  const visible = filtered;

  return (
    <div>
      <div className="flex items-center gap-2 sm:gap-4 mb-4 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => setSelectedCategory(null)} className="text-diletto-gray-light hover:text-diletto-ink shrink-0">
          ← 戻る
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xl shrink-0">{selectedCategory.icon}</span>
          <h1 className="text-lg sm:text-2xl font-bold break-words">{selectedCategory.name}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <BulkPublishButtons
            table="announcements"
            items={visible.map((a) => ({ id: a.id, is_published: a.is_published ?? true }))}
            scopeLabel="このカテゴリ"
            onChanged={() => tenantId && reloadAnnouncements(tenantId)}
          />
          <Button onClick={() => {
            setForm({ title: '', category_id: selectedCategory && selectedCategory.id !== 'none' ? selectedCategory.id : null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
            setBlocks([]);
            setDialogOpen(true);
          }}>+ 投稿する</Button>
        </div>
      </div>


      <div className="space-y-3">
        {visible.map((a) => (
          <Card key={a.id} className="rounded-lg shadow-sm border-diletto-gray/5 overflow-hidden">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-3">
                <ReorderButtons table="announcements" itemId={a.id} items={visible} onReordered={() => tenantId && reloadAnnouncements(tenantId)} />
                <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                  <p className="font-bold text-diletto-ink break-words md:truncate">{a.title}</p>
                  <PersonInline label="作成者" person={a.creator} />
                  {a.created_by !== a.updated_by && <PersonInline label="編集者" person={a.editor} />}
                </div>
                <div className="flex items-center gap-2 flex-wrap order-2 md:order-none">
                  <PublishToggleButton
                    table="announcements"
                    id={a.id}
                    isPublished={a.is_published ?? true}
                    onChanged={() => tenantId && reloadAnnouncements(tenantId)}
                  />
                  <NewBadge createdAt={a.created_at} />
                  <CategoryBadge category={a.category_id ? catMap.get(a.category_id) : null} />
                </div>
              </div>
              <p className="text-sm text-diletto-gray mt-1 whitespace-pre-wrap line-clamp-3 leading-relaxed">{a.body}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <p className="text-xs text-diletto-gray-light">{new Date(a.created_at).toLocaleDateString('ja-JP')}</p>
                <TargetAttributeBadges
                  targetType={a.target_type}
                  targetFacilityIds={a.target_facility_ids}
                  targetPositionIds={a.target_position_ids}
                  facilities={facilities}
                  positions={positions}
                />
              </div>
            </CardContent>
          </Card>
        ))}
        {visible.length === 0 && (
          <Card><CardContent className="py-12 text-center text-diletto-gray-light">お知らせはありません</CardContent></Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>お知らせの追加</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            <AttributeTargetSelector
              tenantId={tenantId}
              targetType={form.target_type}
              targetFacilityIds={form.target_facility_ids}
              targetPositionIds={form.target_position_ids}
              onChange={(next) => setForm({ ...form, ...next })}
            />
            <div className="space-y-2">
              <Label>タイトル *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>コンテンツブロック（文章・画像・動画・PDF）*</Label>
              <BlockEditor tenantId={tenantId} blocks={blocks} onChange={setBlocks} storagePrefix="announcements" />
            </div>
            <CategorySelect
              type="announcement"
              value={form.category_id}
              onChange={(id) => setForm({ ...form, category_id: id })}
              label="カテゴリ（任意）"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title.trim() || blocks.length === 0}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
