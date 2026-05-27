'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CategorySelect, CategoryBadge } from '@/components/admin/CategorySelect';
import { categoryAudienceToItem } from '@/lib/category-audience-prefill';
import { CategoryManagerModal } from '@/components/admin/CategoryManagerModal';
import { NewBadge } from '@/components/admin/NewBadge';
import { PersonInline } from '@/components/admin/PersonInline';
import { DragSortList, DragSortItem, DragHandleIcon, reorderViaSortColumn } from '@/components/admin/DragSortList';
import { nextSortOrder } from '@/lib/sort-helpers';
import { BlockEditor, type ContentBlock } from '@/components/admin/BlockEditor';
import { PublishToggleButton } from '@/components/admin/PublishToggleButton';
import { BulkPublishButtons } from '@/components/admin/BulkPublishButtons';
import { AttributeTargetSelector, TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { TargetScopeBadge } from '@/components/admin/FacilityScopeSelector';
import { enqueueNotification, QUIET_HOURS_LABEL } from '@/lib/notifications/queue';
import { notifyPushOnPublish } from '@/lib/push/notify-publish-client';
import { ImportantUpdateConfirmModal } from '@/components/admin/ImportantUpdateConfirmModal';
import { toast } from 'sonner';
import { deleteRowWithMediaCleanup, cleanupRemovedBlocks } from '@/lib/content-blocks/storage-cleanup';
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
  const [importantUpdateTarget, setImportantUpdateTarget] = useState<{ id: string; title: string } | null>(null);
  /* 編集時のみ: ON にすると recert_at を進めて全受講者に再受講を要求する
     (content-version-tracking)。編集ダイアログを開くたび既定 OFF。 */
  const [requireRecert, setRequireRecert] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const supabase = createClient();

  /* カテゴリだけ再 fetch（CategoryManagerModal でカテゴリ追加・編集・削除されたとき用） */
  const reloadCategories = useCallback(async () => {
    const catRes = await fetch('/api/categories?type=training');
    if (catRes.ok) setCategories(await catRes.json());
  }, []);

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
      /* 更新（updated_by 記録）。requireRecert=ON のときだけ recert_at を now() に
         進め、過去の合格を「旧版」にして再受講を促す (content-version-tracking)。
         OFF なら recert_at を update 句に含めず据え置く。 */
      const oldBlocks = (editingTraining.content_blocks ?? []) as ContentBlock[];
      const updatePayload: Record<string, unknown> = { ...trainingData, updated_by: myEmployeeId };
      if (requireRecert) updatePayload.recert_at = new Date().toISOString();
      const { error } = await supabase
        .from('trainings')
        .update(updatePayload)
        .eq('id', editingTraining.id);

      if (error) {
        toast.error('更新に失敗しました');
        setSaving(false);
        return;
      }
      /* 編集で消えたブロックの Storage を後追い削除 */
      await cleanupRemovedBlocks(supabase, oldBlocks, blocks, `trainings/${editingTraining.id}`);

      // リストを再取得して creator/editor を最新に
      await reloadTrainings(tenantId);
      toast.success('研修を更新しました');
      /* v2: 公開中の研修を編集 → 重要更新確認モーダル（training_submissions 保護） */
      if (editingTraining.is_published !== false) {
        setImportantUpdateTarget({ id: editingTraining.id, title: form.title.trim() });
      }
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
      await Promise.allSettled([
        enqueueNotification('training', (data as Training).id),
        notifyPushOnPublish('training', (data as Training).id, 'publish'),
      ]);
      toast.success(`研修を登録しました。スマホ通知を送信、2時間後 (${QUIET_HOURS_LABEL}) にメール通知されます。`);
    }

    setDialogOpen(false);
    setEditingTraining(null);
    setBlocks([]); setForm({ title: '', body: '', pdf_storage_path: '', youtube_url: '', category_id: null, target_type: 'all', target_facility_ids: [], target_position_ids: [] });
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('この研修を削除しますか？\n\n提出済みのデータも一緒に削除されます。')) return;
    const result = await deleteRowWithMediaCleanup(supabase, 'trainings', id);
    if (!result.deleted) {
      toast.error('削除に失敗しました', { description: result.error });
      return;
    }
    if (tenantId) await reloadTrainings(tenantId);
    if (result.storageFailed > 0) {
      toast.success(`研修を削除しました（Storage 残 ${result.storageFailed} 件は後続クリーンアップ）`);
    } else {
      toast.success('研修を削除しました');
    }
  }

  function openEdit(t: Training) {
    setEditingTraining(t);
    setRequireRecert(false); /* 編集ダイアログを開くたび既定 OFF */
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

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;

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
            <CategoryManagerModal type="training" onChanged={reloadCategories} />
          </div>
        </div>

        <p className="text-sm text-brand-gray mb-6">カテゴリを選択して研修内容を確認・編集してください。新規作成はカテゴリを開いて行います。</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {categories.map((cat) => {
            const catDocs = trainings.filter(d => d.category_id === cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-brand-gray/5 hover:border-brand-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
              >
                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '🎓'}
                  </span>
                </div>
                <div className="relative">
                  <span className="text-sm font-bold text-brand-ink block truncate mb-1">{cat.name}</span>
                  <span className="text-[10px] text-brand-gray">{catDocs.length} 項目</span>
                  {/* 205: カテゴリ audience バッジ */}
                  <div className="mt-1">
                    <TargetScopeBadge
                      targetType={cat.target_type ?? 'all'}
                      targetFacilityIds={cat.target_facility_ids ?? []}
                      facilities={facilities}
                    />
                  </div>
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

  const filtered = selectedCategory.id === 'none'
    ? uncategorizedDocs
    : trainings.filter(d => d.category_id === selectedCategory.id);

  const visible = filtered;

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
            table="trainings"
            items={visible.map((t) => ({ id: t.id, is_published: t.is_published ?? true }))}
            scopeLabel="このカテゴリ"
            onChanged={() => tenantId && reloadTrainings(tenantId)}
          />
          <Button onClick={() => {
            setEditingTraining(null);
            setRequireRecert(false);
            setBlocks([]);
            /* v2 (205): カテゴリ別ビューから新規追加時、そのカテゴリの audience も初期値に */
            { const cat = selectedCategory && selectedCategory.id !== 'none' ? selectedCategory : null;
              const aud = categoryAudienceToItem(cat as Category | null);
              setForm({ title: '', body: '', pdf_storage_path: '', youtube_url: '',
                category_id: cat ? cat.id : null,
                target_type: aud.target_type,
                target_facility_ids: aud.target_facility_ids,
                target_position_ids: [],
              });
            }
            setDialogOpen(true);
          }}>+ 研修を追加</Button>
        </div>
      </div>


      <DragSortList
        className="space-y-3"
        onReorder={(from, to) =>
          reorderViaSortColumn('trainings', visible, from, to, () => tenantId && reloadTrainings(tenantId))
        }
      >
        {visible.map((t, idx) => (
          <DragSortItem key={t.id} index={idx}>
            {(handle) => (
          <Card className="rounded-lg shadow-sm border-brand-gray/5 overflow-hidden" style={{ background: handle.isDropTarget ? 'var(--accent-pale)' : undefined }}>
            <CardContent className="flex flex-wrap items-center gap-3 py-4">
              <DragHandleIcon {...handle} />
              <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                <p className="font-bold text-brand-ink break-words md:truncate">{t.title}</p>
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
                <Button size="sm" onClick={() => openEdit(t)} className="rounded-md font-bold bg-brand-blue hover:bg-brand-blue/90 text-white">✎ 編集</Button>
                <Link href={`/admin/trainings/${t.id}/submissions`}>
                  <Button variant="outline" size="sm" className="rounded-md font-bold">提出一覧</Button>
                </Link>
                <Button variant="outline" size="sm" className="rounded-md font-bold text-brand-red border-brand-red/40 hover:bg-brand-red/10" onClick={() => handleDelete(t.id)}>
                  削除
                </Button>
              </div>
            </CardContent>
          </Card>
            )}
          </DragSortItem>
        ))}
        {visible.length === 0 && (
          <Card><CardContent className="py-12 text-center text-brand-gray-light">研修がありません</CardContent></Card>
        )}
      </DragSortList>

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
              onChange={(id, cat) => {
                /* v2 (205): カテゴリ選択時、audience prefill */
                const aud = categoryAudienceToItem(cat ?? null);
                setForm({
                  ...form,
                  category_id: id,
                  target_type: aud.target_type,
                  target_facility_ids: aud.target_facility_ids,
                });
              }}
              label="カテゴリ（任意）"
            />
            {/* 再受講要求チェック: 編集時のみ表示。研修の内容を大きく変えたときに ON にする。
               content-version-tracking — ON で recert_at を進め、過去の合格を旧版化。 */}
            {editingTraining && (
              <label className="flex items-start gap-2 rounded-md border border-brand-gray/15 bg-brand-beige/30 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireRecert}
                  onChange={(e) => setRequireRecert(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span className="text-sm">
                  <span className="font-bold">この変更で再受講を求める</span>
                  <span className="block text-xs text-brand-gray-light mt-0.5">
                    ON にすると、これまで合格した社員も「再受講が必要」扱いになり、閲覧レポート・
                    ダッシュボードで未達成に戻ります。誤字修正など軽微な編集では OFF のままにしてください。
                  </span>
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {importantUpdateTarget && (
        <ImportantUpdateConfirmModal
          open={true}
          contentType="training"
          itemId={importantUpdateTarget.id}
          itemTitle={importantUpdateTarget.title}
          onClose={() => setImportantUpdateTarget(null)}
        />
      )}
    </div >
  );
}
