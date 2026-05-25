'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { ImportantUpdateConfirmModal } from '@/components/admin/ImportantUpdateConfirmModal';
import { AttributeTargetSelector, TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { TargetScopeBadge } from '@/components/admin/FacilityScopeSelector';
import { enqueueNotification, cancelNotification, enqueueOrCancelByPublished, QUIET_HOURS_LABEL } from '@/lib/notifications/queue';
import { notifyPushOnPublish } from '@/lib/push/notify-publish-client';
import { toast } from 'sonner';
import type { Category, Facility, TargetType, Position, ComplianceDoc } from '@/lib/types';

interface AckStatus {
  employee_name: string;
  acknowledged: boolean;
}

export default function AdminCompliancePage() {
  const [docs, setDocs] = useState<ComplianceDoc[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importantUpdateTarget, setImportantUpdateTarget] = useState<{ id: string; title: string } | null>(null);

  // 編集ダイアログ
  const [editOpen, setEditOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<ComplianceDoc | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editBlocks, setEditBlocks] = useState<ContentBlock[]>([]);
  const [editComment, setEditComment] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editTargetType, setEditTargetType] = useState<TargetType>('all');
  const [editTargetFacilityIds, setEditTargetFacilityIds] = useState<string[]>([]);
  const [editTargetPositionIds, setEditTargetPositionIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  // 同意状況ダイアログ
  const [ackOpen, setAckOpen] = useState(false);
  const [ackDocId, setAckDocId] = useState<string | null>(null);
  const [acks, setAcks] = useState<AckStatus[]>([]);

  const supabase = createClient();

  /* カテゴリだけ再 fetch（CategoryManagerModal でカテゴリ追加・編集・削除されたとき用） */
  const reloadCategories = useCallback(async () => {
    const catRes = await fetch('/api/categories?type=compliance');
    if (catRes.ok) setCategories(await catRes.json());
  }, []);

  const loadDocs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: me } = await supabase
      .from('employees')
      .select('tenant_id')
      .eq('auth_user_id', user.id)
      .single();

    if (!me) return;
    setTenantId(me.tenant_id);

    const { data } = await supabase
      .from('compliance_documents')
      .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
      .eq('tenant_id', me.tenant_id)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    setDocs(data || []);

    const catRes = await fetch('/api/categories?type=compliance');
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
  }, [supabase]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  function openNew() {
    setEditDoc(null);
    setEditTitle('');
    setEditContent('');
    setEditBlocks([]);
    setEditComment('');
    /* v2 (205): カテゴリ詳細から新規作成時、そのカテゴリと audience を初期値に */
    {
      const cat = selectedCategory && selectedCategory.id !== 'none' ? selectedCategory : null;
      const aud = categoryAudienceToItem(cat as Category | null);
      setEditCategoryId(cat ? cat.id : null);
      setEditTargetType(aud.target_type);
      setEditTargetFacilityIds(aud.target_facility_ids);
    }
    setEditTargetPositionIds([]);
    setEditOpen(true);
  }

  function openEdit(doc: ComplianceDoc) {
    setEditDoc(doc);
    setEditTitle(doc.title);
    setEditContent(doc.content);
    const existingBlocks = Array.isArray(doc.content_blocks) ? doc.content_blocks as ContentBlock[] : [];
    // 旧データ互換: content_blocks が空でも、プレーンテキストの content があればテキストブロック化して編集可能に
    setEditBlocks(existingBlocks.length > 0 ? existingBlocks : (doc.content ? [{ type: 'text', value: doc.content }] : []));
    setEditComment(doc.admin_comment || '');
    setEditCategoryId(doc.category_id);
    setEditTargetType(doc.target_type);
    setEditTargetFacilityIds(doc.target_facility_ids || []);
    setEditTargetPositionIds(doc.target_position_ids || []);
    setEditOpen(true);
  }

  async function handleSave() {
    if (!tenantId || !editTitle.trim()) return;
    if (editBlocks.length === 0 && !editContent.trim()) {
      toast.error('コンテンツを1ブロック以上追加してください');
      return;
    }
    if (editTargetType === 'facility' && editTargetFacilityIds.length === 0) {
      toast.error('配信対象の施設を1つ以上選択してください');
      return;
    }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from('employees').select('id').eq('auth_user_id', user?.id).single();

    if (editDoc) {
      // 更新 — updated_atを更新して既存のacknowledgmentsを無効化
      const { error } = await supabase
        .from('compliance_documents')
        .update({
          title: editTitle,
          content: editContent,
          content_blocks: editBlocks,
          admin_comment: editComment || null,
          category_id: editCategoryId,
          target_type: editTargetType,
          target_facility_ids: editTargetFacilityIds,
          target_position_ids: editTargetPositionIds,
          updated_at: new Date().toISOString(),
          updated_by: me?.id,
        })
        .eq('id', editDoc.id);

      if (error) { toast.error('保存に失敗しました'); setSaving(false); return; }
      /* 非公開なら enqueue せず cancel + 「メール通知しません」toast に切替 (旧 UX 嘘問題の修正) */
      const isPublished = editDoc.is_published !== false;
      const editedId = editDoc.id;
      const editedTitle = editTitle;
      const { willNotify } = await enqueueOrCancelByPublished('compliance', editedId, isPublished);
      toast.success(
        willNotify
          ? `保存しました。社員は再確認が必要になります。2時間後 (${QUIET_HOURS_LABEL}) にメール通知されます。`
          : '非公開で保存しました(メール通知は行いません)。',
      );
      /* v2: 公開中のアイテムを編集 → 重要更新確認モーダル */
      if (isPublished) {
        setImportantUpdateTarget({ id: editedId, title: editedTitle });
      }
    } else {
      // 新規作成（sort_order は migration 092 適用後のみ付与）
      const nextOrder = await nextSortOrder(supabase, 'compliance_documents', tenantId);
      const basePayload: Record<string, unknown> = {
        tenant_id: tenantId,
        title: editTitle,
        content: editContent,
        content_blocks: editBlocks,
        admin_comment: editComment || null,
        category_id: editCategoryId,
        target_type: editTargetType,
        target_facility_ids: editTargetFacilityIds,
        target_position_ids: editTargetPositionIds,
        created_by: me?.id,
        updated_by: me?.id,
      };
      if (nextOrder !== null) basePayload.sort_order = nextOrder;
      const { data: inserted, error } = await supabase
        .from('compliance_documents')
        .insert(basePayload)
        .select('id')
        .single();

      if (error) { toast.error('作成に失敗しました'); setSaving(false); return; }
      if (inserted) {
        await Promise.allSettled([
          enqueueNotification('compliance', inserted.id),
          notifyPushOnPublish('compliance', inserted.id, 'publish'),
        ]);
      }
      toast.success(`遵守事項を作成しました。スマホ通知を送信、2時間後 (${QUIET_HOURS_LABEL}) にメール通知されます。`);
    }

    setSaving(false);
    setEditOpen(false);
    loadDocs();
  }

  async function handleDelete(docId: string) {
    if (!confirm('この遵守事項を削除しますか？')) return;

    // ON DELETE CASCADE により関連するacknowledgmentsも自動削除される
    const { error } = await supabase
      .from('compliance_documents')
      .delete()
      .eq('id', docId);

    if (error) { toast.error('削除に失敗しました'); return; }
    await cancelNotification('compliance', docId);
    toast.success('削除しました');
    loadDocs();
  }

  async function openAckStatus(doc: ComplianceDoc) {
    setAckDocId(doc.id);
    setAckOpen(true);

    const { data: employees } = await supabase
      .from('employees')
      .select('id, last_name, first_name')
      .eq('tenant_id', tenantId!)
      .eq('status', 'active')
      .neq('role', 'admin');

    // 現在のバージョン（updated_at）に対するacknowledgmentsのみ取得
    const { data: acknowledgments } = await supabase
      .from('compliance_acknowledgments')
      .select('employee_id')
      .eq('compliance_document_id', doc.id)
      .eq('document_updated_at', doc.updated_at);

    const ackSet = new Set((acknowledgments || []).map((a) => a.employee_id));

    setAcks((employees || []).map((e) => ({
      employee_name: `${e.last_name} ${e.first_name}`,
      acknowledged: ackSet.has(e.id),
    })));
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;

  // カテゴリ未設定のドキュメント
  const uncategorizedDocs = docs.filter(d => !d.category_id);

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">遵守事項</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <BulkPublishButtons
              table="compliance_documents"
              items={docs.map((d) => ({ id: d.id, is_published: d.is_published ?? true }))}
              scopeLabel="全体"
              onChanged={loadDocs}
            />
            <CategoryManagerModal type="compliance" onChanged={reloadCategories} />
          </div>
        </div>

        <p className="text-sm text-brand-gray mb-6">カテゴリを選択して内容を確認・編集してください。新規作成はカテゴリを開いて行います。</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {categories.map((cat) => {
            const catDocs = docs.filter(d => d.category_id === cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-brand-gray/5 hover:border-brand-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
              >
                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '📜'}
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

  const filteredDocs = selectedCategory.id === 'none'
    ? uncategorizedDocs
    : docs.filter(d => d.category_id === selectedCategory.id);

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
            table="compliance_documents"
            items={filteredDocs.map((d) => ({ id: d.id, is_published: d.is_published ?? true }))}
            scopeLabel="このカテゴリ"
            onChanged={loadDocs}
          />
          <Button onClick={openNew}>新規作成</Button>
        </div>
      </div>


      {filteredDocs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-brand-gray">
            <p>遵守事項はまだ登録されていません。</p>
            <p className="text-sm mt-1">「新規作成」ボタンから追加してください。</p>
          </CardContent>
        </Card>
      ) : (
        <DragSortList
          className="space-y-4"
          onReorder={(from, to) =>
            reorderViaSortColumn('compliance_documents', filteredDocs, from, to, loadDocs)
          }
        >
          {filteredDocs.map((doc, idx) => {
            const catMap = new Map(categories.map(c => [c.id, c]));
            return (
              <DragSortItem key={doc.id} index={idx}>
                {(handle) => (
              <Card className="rounded-lg shadow-sm border-brand-gray/5 overflow-hidden" style={{ background: handle.isDropTarget ? 'var(--accent-pale)' : undefined }}>
                <CardHeader className="py-4 bg-gray-50/50">
                  <div className="flex flex-wrap items-center gap-3">
                    <DragHandleIcon {...handle} />
                    <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                      <CardTitle className="text-base text-brand-ink break-words md:truncate">{doc.title || '（無題）'}</CardTitle>
                      <PersonInline label="作成者" person={doc.creator} />
                      {doc.created_by !== doc.updated_by && <PersonInline label="編集者" person={doc.editor} />}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap order-2 md:order-none">
                      <NewBadge createdAt={doc.created_at || doc.updated_at} />
                      <CategoryBadge category={doc.category_id ? catMap.get(doc.category_id) : null} />
                    </div>
                    <div className="flex gap-2 flex-wrap order-3 md:order-none">
                      <PublishToggleButton
                        table="compliance_documents"
                        id={doc.id}
                        isPublished={doc.is_published ?? true}
                        onChanged={loadDocs}
                      />
                      <Button variant="outline" size="sm" onClick={() => openAckStatus(doc)} className="rounded-md font-bold">
                        同意状況
                      </Button>
                      <Button size="sm" onClick={() => openEdit(doc)} className="rounded-md font-bold bg-brand-blue hover:bg-brand-blue/90 text-white">
                        ✎ 編集
                      </Button>
                      <Button variant="outline" size="sm" className="rounded-md font-bold text-brand-red border-brand-red/40 hover:bg-brand-red/10" onClick={() => handleDelete(doc.id)}>
                        削除
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed border rounded-md p-3 bg-white max-h-40 overflow-y-auto">
                    {doc.content}
                  </div>
                  {doc.admin_comment && (
                    <p className="text-sm text-brand-gray mt-2 border-l-2 border-brand-blue pl-3">
                      {doc.admin_comment}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <p className="text-xs text-brand-gray-light">
                      最終更新: {new Date(doc.updated_at).toLocaleDateString()}
                    </p>
                    <TargetAttributeBadges
                      targetType={doc.target_type}
                      targetFacilityIds={doc.target_facility_ids}
                      targetPositionIds={doc.target_position_ids}
                      facilities={facilities}
                      positions={positions}
                    />
                  </div>
                </CardContent>
              </Card>
                )}
              </DragSortItem>
            );
          })}
        </DragSortList>
      )}

      {/* 編集ダイアログ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editDoc ? '遵守事項の編集' : '遵守事項の追加'}</DialogTitle>
            {editDoc && (
              <DialogDescription>
                内容を編集すると、社員に再確認が求められます。
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            <AttributeTargetSelector
              tenantId={tenantId}
              targetType={editTargetType}
              targetFacilityIds={editTargetFacilityIds}
              targetPositionIds={editTargetPositionIds}
              onChange={(next) => {
                setEditTargetType(next.target_type);
                setEditTargetFacilityIds(next.target_facility_ids);
                setEditTargetPositionIds(next.target_position_ids);
              }}
            />
            <div className="space-y-2">
              <Label>タイトル *</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="例: 個人情報保護方針"
              />
            </div>
            <div className="space-y-2">
              <Label>コンテンツブロック（文章・画像・動画・PDF）*</Label>
              <BlockEditor tenantId={tenantId} blocks={editBlocks} onChange={setEditBlocks} storagePrefix="compliance" />
            </div>
            <CategorySelect
              type="compliance"
              value={editCategoryId}
              onChange={(id, cat) => {
                /* v2 (205): カテゴリ選択時、audience prefill */
                setEditCategoryId(id);
                const aud = categoryAudienceToItem(cat ?? null);
                setEditTargetType(aud.target_type);
                setEditTargetFacilityIds(aud.target_facility_ids);
              }}
              label="カテゴリ（任意）"
            />
            <div className="space-y-2">
              <Label>管理者コメント（任意）</Label>
              <Textarea
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                rows={3}
                placeholder="補足コメント"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave} disabled={saving || !editTitle.trim() || editBlocks.length === 0}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 同意状況ダイアログ */}
      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>同意状況</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {acks.length === 0 ? (
              <p className="text-sm text-brand-gray py-4 text-center">対象の社員はいません</p>
            ) : (
              acks.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-sm">{a.employee_name}</span>
                  {a.acknowledged ? (
                    <Badge className="bg-brand-green/10 text-brand-green">同意済</Badge>
                  ) : (
                    <Badge className="bg-brand-red/[0.06] text-brand-red">未同意</Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
      {importantUpdateTarget && (
        <ImportantUpdateConfirmModal
          open={true}
          contentType="compliance"
          itemId={importantUpdateTarget.id}
          itemTitle={importantUpdateTarget.title}
          onClose={() => setImportantUpdateTarget(null)}
        />
      )}
    </div>
  );
}
