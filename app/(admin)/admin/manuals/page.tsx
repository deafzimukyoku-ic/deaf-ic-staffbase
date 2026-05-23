'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
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
import { enqueueNotification, cancelNotification, enqueueOrCancelByPublished, QUIET_HOURS_LABEL } from '@/lib/notifications/queue';
import { DragSortList, DragSortItem, DragHandleIcon, reorderViaSortColumn } from '@/components/admin/DragSortList';
import { nextSortOrder } from '@/lib/sort-helpers';
import { AttributeTargetSelector, TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { BlockEditor, type ContentBlock } from '@/components/admin/BlockEditor';
import { PublishToggleButton } from '@/components/admin/PublishToggleButton';
import { BulkPublishButtons } from '@/components/admin/BulkPublishButtons';
import { ImportantUpdateConfirmModal } from '@/components/admin/ImportantUpdateConfirmModal';
import { notifyPushOnPublish } from '@/lib/push/notify-publish-client';
import { toast } from 'sonner';
import type { Manual, Category, Facility, Position } from '@/lib/types';

type TargetType = 'all' | 'facility';

export default function AdminManualsPage() {
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [editingManual, setEditingManual] = useState<Manual | null>(null);
  const [importantUpdateTarget, setImportantUpdateTarget] = useState<{ id: string; title: string } | null>(null);
  const [form, setForm] = useState<{
    title: string;
    category_id: string | null;
    target_type: TargetType;
    target_facility_ids: string[];
    target_position_ids: string[];
  }>({ title: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
  const supabase = createClient();

  /* カテゴリだけ再 fetch（CategoryManagerModal でカテゴリ追加・編集・削除されたとき用） */
  const reloadCategories = useCallback(async () => {
    const catRes = await fetch('/api/categories?type=manual');
    if (catRes.ok) setCategories(await catRes.json());
  }, []);

  async function reloadManuals(tid: string) {
    const { data } = await supabase
      .from('manuals')
      .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
      .eq('tenant_id', tid)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    setManuals((data as Manual[]) || []);
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;
      setTenantId(me.tenant_id);

      await reloadManuals(me.tenant_id);

      const catRes = await fetch('/api/categories?type=manual');
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

  async function handleSave() {
    if (!tenantId || !form.title.trim()) return;
    if (blocks.length === 0) {
      toast.error('コンテンツブロックを1つ以上追加してください');
      return;
    }
    if (form.target_type === 'facility' && form.target_facility_ids.length === 0) {
      toast.error('配信対象の施設を1つ以上選択してください');
      return;
    }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from('employees').select('id').eq('auth_user_id', user?.id).single();

    if (editingManual) {
      const { error } = await supabase
        .from('manuals')
        .update({
          title: form.title.trim(),
          content_blocks: blocks,
          category_id: form.category_id,
          target_type: form.target_type,
          target_facility_ids: form.target_facility_ids,
          target_position_ids: form.target_position_ids,
          updated_by: me?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingManual.id);

      if (error) {
        toast.error('保存に失敗しました', { description: error.message });
        setSaving(false);
        return;
      }
      /* 非公開なら enqueue せず cancel + toast 切替 (旧 UX 嘘問題の修正) */
      const isPublished = editingManual.is_published !== false;
      const editedId = editingManual.id;
      const editedTitle = form.title.trim();
      const { willNotify } = await enqueueOrCancelByPublished('manual', editedId, isPublished);
      await reloadManuals(tenantId);
      setDialogOpen(false);
      setEditingManual(null);
      setForm({ title: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
      setBlocks([]);
      toast.success(
        willNotify
          ? `業務マニュアルを更新しました。2時間後 (${QUIET_HOURS_LABEL}) に対象社員へメール通知されます。`
          : '業務マニュアルを非公開で更新しました(メール通知は行いません)。',
      );
      /* v2: 公開中のアイテムを編集 → 重要更新確認モーダル */
      if (isPublished) {
        setImportantUpdateTarget({ id: editedId, title: editedTitle });
      }
      setSaving(false);
      return;
    }

    const nextOrder = await nextSortOrder(supabase, 'manuals', tenantId);
    const insertPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      title: form.title.trim(),
      content_blocks: blocks,
      category_id: form.category_id,
      target_type: form.target_type,
      target_facility_ids: form.target_facility_ids,
      target_position_ids: form.target_position_ids,
      created_by: me?.id,
      updated_by: me?.id,
    };
    if (nextOrder !== null) insertPayload.sort_order = nextOrder;
    const { data: inserted, error } = await supabase
      .from('manuals')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      toast.error('投稿に失敗しました');
      setSaving(false);
      return;
    }

    if (inserted?.id) {
      await Promise.allSettled([
        enqueueNotification('manual', inserted.id),
        notifyPushOnPublish('manual', inserted.id, 'publish'),
      ]);
    }

    await reloadManuals(tenantId);
    setDialogOpen(false);
    setForm({ title: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
    setBlocks([]);
    toast.success(`業務マニュアルを投稿しました。2時間後 (${QUIET_HOURS_LABEL}) に対象社員へメール通知されます。`);
    setSaving(false);
  }

  function openEdit(m: Manual) {
    setEditingManual(m);
    setForm({
      title: m.title,
      category_id: m.category_id,
      target_type: m.target_type,
      target_facility_ids: m.target_facility_ids || [],
      target_position_ids: m.target_position_ids || [],
    });
    setBlocks(Array.isArray(m.content_blocks) ? m.content_blocks as ContentBlock[] : []);
    setDialogOpen(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('この業務マニュアルを削除しますか？')) return;
    const { error } = await supabase.from('manuals').delete().eq('id', id);
    if (error) { toast.error('削除に失敗しました', { description: error.message }); return; }
    await cancelNotification('manual', id);
    if (tenantId) await reloadManuals(tenantId);
    toast.success('業務マニュアルを削除しました');
  }

  const catMap = new Map(categories.map(c => [c.id, c]));

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;

  const uncategorizedDocs = manuals.filter(d => !d.category_id);

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">業務マニュアル</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <BulkPublishButtons
              table="manuals"
              items={manuals.map((m) => ({ id: m.id, is_published: m.is_published ?? true }))}
              scopeLabel="全体"
              onChanged={() => tenantId && reloadManuals(tenantId)}
            />
            <CategoryManagerModal type="manual" onChanged={reloadCategories} />
          </div>
        </div>

        <p className="text-sm text-brand-gray mb-6">カテゴリを選択してマニュアルを確認・修正してください。新規投稿はカテゴリを開いて行います。</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {categories.map((cat) => {
            const catDocs = manuals.filter(d => d.category_id === cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-brand-gray/5 hover:border-brand-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
              >
                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '📖'}
                  </span>
                </div>
                <div className="relative">
                  <span className="text-sm font-bold text-brand-ink block truncate mb-1">{cat.name}</span>
                  <span className="text-[10px] text-brand-gray">{catDocs.length} 項目</span>
                </div>
              </button>
            );
          })}

          {uncategorizedDocs.length > 0 && (
            <button
              onClick={() => setSelectedCategory({ id: 'none', name: 'その他', icon: '📎', color: '#94a3b8' } as any)}
              className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-brand-gray/5 hover:border-brand-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
            >
              <div className="flex justify-between items-start mb-auto relative">
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300">📎</span>
              </div>
              <div className="relative">
                <span className="text-sm font-bold text-brand-ink block mb-1">その他</span>
                <span className="text-[10px] text-brand-gray block">{uncategorizedDocs.length} 項目</span>
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  const visible = selectedCategory.id === 'none'
    ? uncategorizedDocs
    : manuals.filter(d => d.category_id === selectedCategory.id);

  return (
    <div>
      <div className="flex items-center gap-2 sm:gap-4 mb-4 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => setSelectedCategory(null)} className="text-brand-gray-light hover:text-brand-ink shrink-0">
          ← 戻る
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xl shrink-0">{selectedCategory.icon}</span>
          <h1 className="text-lg sm:text-2xl font-bold truncate">{selectedCategory.name}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:ml-auto">
          <BulkPublishButtons
            table="manuals"
            items={visible.map((m) => ({ id: m.id, is_published: m.is_published ?? true }))}
            scopeLabel="このカテゴリ"
            onChanged={() => tenantId && reloadManuals(tenantId)}
          />
          <Button onClick={() => {
            setEditingManual(null);
            setForm({ title: '', category_id: selectedCategory && selectedCategory.id !== 'none' ? selectedCategory.id : null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
            setBlocks([]);
            setDialogOpen(true);
          }}>+ 投稿する</Button>
        </div>
      </div>

      <DragSortList
        className="space-y-3"
        onReorder={(from, to) =>
          reorderViaSortColumn('manuals', visible, from, to, () => tenantId && reloadManuals(tenantId))
        }
      >
        {visible.map((m, idx) => (
          <DragSortItem key={m.id} index={idx}>
            {(handle) => (
          <Card className="rounded-lg shadow-sm border-brand-gray/5 overflow-hidden" style={{ background: handle.isDropTarget ? 'var(--accent-pale)' : undefined }}>
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-3">
                <DragHandleIcon {...handle} />
                <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                  <p className="font-bold text-brand-ink break-words md:truncate">{m.title}</p>
                  <PersonInline label="作成者" person={m.creator} />
                  {m.created_by !== m.updated_by && <PersonInline label="編集者" person={m.editor} />}
                </div>
                <div className="flex items-center gap-2 flex-wrap order-2 md:order-none">
                  <PublishToggleButton
                    table="manuals"
                    id={m.id}
                    isPublished={m.is_published ?? true}
                    onChanged={() => tenantId && reloadManuals(tenantId)}
                  />
                  <NewBadge createdAt={m.created_at} />
                  <CategoryBadge category={m.category_id ? catMap.get(m.category_id) : null} />
                  {m.pdf_storage_path && (
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">📄 PDF</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap order-3 md:order-none">
                  <Button size="sm" onClick={() => openEdit(m)} className="rounded-md font-bold bg-brand-blue hover:bg-brand-blue/90 text-white">✎ 編集</Button>
                  <Button variant="outline" size="sm" className="rounded-md font-bold text-brand-red border-brand-red/40 hover:bg-brand-red/10" onClick={() => handleDelete(m.id)}>
                    削除
                  </Button>
                </div>
              </div>
              {m.body && <p className="text-sm text-brand-gray mt-1 whitespace-pre-wrap line-clamp-3 leading-relaxed">{m.body}</p>}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <p className="text-xs text-brand-gray-light">{new Date(m.created_at).toLocaleDateString('ja-JP')}</p>
                <TargetAttributeBadges
                  targetType={m.target_type}
                  targetFacilityIds={m.target_facility_ids}
                  targetPositionIds={m.target_position_ids}
                  facilities={facilities}
                  positions={positions}
                />
              </div>
            </CardContent>
          </Card>
            )}
          </DragSortItem>
        ))}
        {visible.length === 0 && (
          <Card><CardContent className="py-12 text-center text-brand-gray-light">業務マニュアルはありません</CardContent></Card>
        )}
      </DragSortList>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditingManual(null); setBlocks([]); } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editingManual ? '業務マニュアルの編集' : '業務マニュアルの追加'}</DialogTitle></DialogHeader>
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
              <BlockEditor tenantId={tenantId} blocks={blocks} onChange={setBlocks} storagePrefix="manuals" />
            </div>
            <CategorySelect
              type="manual"
              value={form.category_id}
              onChange={(id) => setForm({ ...form, category_id: id })}
              label="カテゴリ（任意）"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingManual(null); setBlocks([]); }}>キャンセル</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim() || blocks.length === 0}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {importantUpdateTarget && (
        <ImportantUpdateConfirmModal
          open={true}
          contentType="manual"
          itemId={importantUpdateTarget.id}
          itemTitle={importantUpdateTarget.title}
          onClose={() => setImportantUpdateTarget(null)}
        />
      )}
    </div>
  );
}
