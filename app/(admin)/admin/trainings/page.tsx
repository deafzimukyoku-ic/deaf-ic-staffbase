'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CategorySelect, CategoryBadge } from '@/components/admin/CategorySelect';
import { CategoryManagerModal } from '@/components/admin/CategoryManagerModal';
import { NewBadge } from '@/components/admin/NewBadge';
import { PersonInline } from '@/components/admin/PersonInline';
import { ReorderButtons } from '@/components/admin/ReorderButtons';
import { nextSortOrder } from '@/lib/sort-helpers';
import { BlockEditor, type ContentBlock } from '@/components/admin/BlockEditor';
import { PublishToggleButton } from '@/components/admin/PublishToggleButton';
import { BulkPublishButtons } from '@/components/admin/BulkPublishButtons';
import { AttributeTargetSelector, TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { enqueueNotification } from '@/lib/notifications/queue';
import { toast } from 'sonner';
import type { Training, Category, Facility, TargetType, Position } from '@/lib/types';

export default function AdminTrainingsPage() {
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    body: string;
    pdf_storage_path: string;
    youtube_url: string;
    category_id: string | null;
    target_type: TargetType;
    target_facility_ids: string[];
    target_position_ids: string[];
    creator?: { last_name: string | null; first_name: string | null; email: string | null } | null;
  }>({ title: '', body: '', pdf_storage_path: '', youtube_url: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [editingTraining, setEditingTraining] = useState<Training | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const supabase = createClient();

  async function reloadTrainings(tid: string) {
    const { data } = await supabase
      .from('trainings')
      .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
      .eq('tenant_id', tid)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    setTrainings((data as Training[]) || []);
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me } = await supabase
        .from('employees')
        .select('id, tenant_id')
        .eq('auth_user_id', user.id)
        .single();

      if (!me) return;
      setTenantId(me.tenant_id);
      setMyEmployeeId(me.id);

      await reloadTrainings(me.tenant_id);

      const catRes = await fetch('/api/categories?type=training');
      if (catRes.ok) setCategories(await catRes.json());

      const { data: facData } = await supabase
        .from('facilities')
        .select('id, name, tenant_id, address, created_at')
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
    if (form.target_type === 'facility' && form.target_facility_ids.length === 0) {
      toast.error('配信対象の施設を1つ以上選択してください');
      return;
    }
    setSaving(true);

    const trainingData = {
      tenant_id: tenantId,
      title: form.title.trim(),
      body: form.body.trim(),
      content_blocks: blocks,
      pdf_storage_path: form.pdf_storage_path.trim() || null,
      youtube_url: form.youtube_url.trim() || null,
      category_id: form.category_id,
      target_type: form.target_type,
      target_facility_ids: form.target_facility_ids,
      target_position_ids: form.target_position_ids,
    };

    if (editingTraining) {
      // 更新（updated_by 記録）
      const { error } = await supabase
        .from('trainings')
        .update({ ...trainingData, updated_by: myEmployeeId })
        .eq('id', editingTraining.id);

      if (error) {
        toast.error('更新に失敗しました');
        setSaving(false);
        return;
      }

      // リストを再取得して creator/editor を最新に
      await reloadTrainings(tenantId);
      toast.success('研修を更新しました');
    } else {
      // 新規作成: created_by と updated_by 両方セット（初回は同じ employee）
      const nextOrder = await nextSortOrder(supabase, 'trainings', tenantId);
      const insertPayload: Record<string, unknown> = {
        ...trainingData,
        created_by: myEmployeeId,
        updated_by: myEmployeeId,
      };
      if (nextOrder !== null) insertPayload.sort_order = nextOrder;
      const { data, error } = await supabase
        .from('trainings')
        .insert(insertPayload)
        .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
        .single();

      if (error) {
        toast.error('登録に失敗しました');
        setSaving(false);
        return;
      }

      setTrainings((prev) => [data as Training, ...prev]);
      await enqueueNotification('training', (data as Training).id);
      toast.success('研修を登録しました。2時間後に対象社員へメール通知されます。');
    }

    setDialogOpen(false);
    setEditingTraining(null);
    setBlocks([]); setForm({ title: '', body: '', pdf_storage_path: '', youtube_url: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
    setSaving(false);
  }

  function openEdit(t: Training) {
    setEditingTraining(t);
    setForm({
      title: t.title,
      body: t.body || '',
      pdf_storage_path: t.pdf_storage_path || '',
      youtube_url: t.youtube_url || '',
      category_id: t.category_id,
      target_type: t.target_type,
      target_facility_ids: t.target_facility_ids || [],
      target_position_ids: t.target_position_ids || [],
    });
    setBlocks(Array.isArray(t.content_blocks) ? t.content_blocks as ContentBlock[] : []);
    setDialogOpen(true);
  }

  const catMap = new Map(categories.map(c => [c.id, c]));

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  // カテゴリ未設定のドキュメント
  const uncategorizedDocs = trainings.filter(d => !d.category_id);

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">研修管理</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <BulkPublishButtons
              table="trainings"
              items={trainings.map((t) => ({ id: t.id, is_published: t.is_published ?? true }))}
              scopeLabel="全体"
              onChanged={() => tenantId && reloadTrainings(tenantId)}
            />
            <CategoryManagerModal type="training" />
          </div>
        </div>

        <p className="text-sm text-diletto-gray mb-6">カテゴリを選択して研修内容を確認・編集してください。新規作成はカテゴリを開いて行います。</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {categories.map((cat) => {
            const catDocs = trainings.filter(d => d.category_id === cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
              >
                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '🎓'}
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
    : trainings.filter(d => d.category_id === selectedCategory.id);

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
            table="trainings"
            items={visible.map((t) => ({ id: t.id, is_published: t.is_published ?? true }))}
            scopeLabel="このカテゴリ"
            onChanged={() => tenantId && reloadTrainings(tenantId)}
          />
          <Button onClick={() => {
            setEditingTraining(null);
            setBlocks([]); setForm({ title: '', body: '', pdf_storage_path: '', youtube_url: '', category_id: selectedCategory && selectedCategory.id !== 'none' ? selectedCategory.id : null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
            setDialogOpen(true);
          }}>+ 研修を追加</Button>
        </div>
      </div>


      <div className="space-y-3">
        {visible.map((t) => (
          <Card key={t.id} className="rounded-lg shadow-sm border-diletto-gray/5 overflow-hidden">
            <CardContent className="flex flex-wrap items-center gap-3 py-4">
              <ReorderButtons table="trainings" itemId={t.id} items={visible} onReordered={() => tenantId && reloadTrainings(tenantId)} />
              <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                <p className="font-bold text-diletto-ink break-words md:truncate">{t.title}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <TargetAttributeBadges
                    targetType={t.target_type}
                    targetFacilityIds={t.target_facility_ids}
                    targetPositionIds={t.target_position_ids}
                    facilities={facilities}
                    positions={positions}
                  />
                  <div className="ml-2 flex items-center gap-2 flex-wrap">
                    <PersonInline label="作成者" person={t.creator} />
                    {t.created_by !== t.updated_by && <PersonInline label="編集者" person={t.editor} />}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap order-2 md:order-none">
                <NewBadge createdAt={t.created_at} />
                <CategoryBadge category={t.category_id ? catMap.get(t.category_id) : null} />
              </div>
              <div className="flex items-center gap-2 flex-wrap order-3 md:order-none">
                <PublishToggleButton
                  table="trainings"
                  id={t.id}
                  isPublished={t.is_published ?? true}
                  onChanged={() => tenantId && reloadTrainings(tenantId)}
                />
                <Button variant="ghost" size="sm" onClick={() => openEdit(t)} className="h-8 rounded-md text-xs font-bold">編集</Button>
                <Link href={`/admin/trainings/${t.id}/submissions`}>
                  <Button variant="outline" size="sm" className="h-8 rounded-md text-xs font-bold">提出一覧</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
        {visible.length === 0 && (
          <Card><CardContent className="py-12 text-center text-diletto-gray-light">研修がありません</CardContent></Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editingTraining ? '研修の編集' : '研修の追加'}</DialogTitle></DialogHeader>
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
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="安全運転研修" />
            </div>
            <div className="space-y-2">
              <Label>補足説明（任意）</Label>
              <Input value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="この研修の概要・狙いを1行で" />
            </div>
            <div className="space-y-2">
              <Label>コンテンツブロック（文章・画像・動画・PDF）</Label>
              <BlockEditor tenantId={tenantId} blocks={blocks} onChange={setBlocks} storagePrefix="trainings" />
            </div>
            <CategorySelect
              type="training"
              value={form.category_id}
              onChange={(id) => setForm({ ...form, category_id: id })}
              label="カテゴリ（任意）"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
}
