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
import { toast } from 'sonner';
import { NewBadge } from '@/components/admin/NewBadge';
import { PersonInline } from '@/components/admin/PersonInline';
import { DragSortList, DragSortItem, DragHandleIcon, reorderViaSortColumn } from '@/components/admin/DragSortList';
import { nextSortOrder } from '@/lib/sort-helpers';
import { CategorySelect, CategoryBadge } from '@/components/admin/CategorySelect';
import { CategoryManagerModal } from '@/components/admin/CategoryManagerModal';
import { BlockEditor, type ContentBlock } from '@/components/admin/BlockEditor';
import { PublishToggleButton } from '@/components/admin/PublishToggleButton';
import { BulkPublishButtons } from '@/components/admin/BulkPublishButtons';
import { TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { enqueueNotification, cancelNotification } from '@/lib/notifications/queue';
import type { Category, ComplianceDoc, Position } from '@/lib/types';

interface AckStatus {
  employee_name: string;
  acknowledged: boolean;
}

interface MeRow {
  id: string;
  tenant_id: string;
  last_name: string;
  first_name: string;
  facility_id: string | null;
  role: string;
}

export default function ManagerCompliancePage() {
  const [me, setMe] = useState<MeRow | null>(null);
  const [docs, setDocs] = useState<ComplianceDoc[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [managedFacilities, setManagedFacilities] = useState<{ id: string; name: string }[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 編集ダイアログ
  const [editOpen, setEditOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<ComplianceDoc | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editBlocks, setEditBlocks] = useState<ContentBlock[]>([]);
  const [editComment, setEditComment] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editTargetFacilityIds, setEditTargetFacilityIds] = useState<string[]>([]);

  // 同意状況ダイアログ
  const [ackOpen, setAckOpen] = useState(false);
  const [acks, setAcks] = useState<AckStatus[]>([]);

  const supabase = createClient();

  /* カテゴリだけ再 fetch（CategoryManagerModal でカテゴリ追加・編集・削除されたとき用） */
  const reloadCategories = useCallback(async () => {
    const catRes = await fetch('/api/categories?type=compliance');
    if (catRes.ok) setCategories(await catRes.json());
  }, []);

  const loadDocs = useCallback(async (tid: string) => {
    const { data } = await supabase
      .from('compliance_documents')
      .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
      .eq('tenant_id', tid)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    setDocs((data as ComplianceDoc[]) || []);
  }, [supabase]);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: meData } = await supabase
        .from('employees')
        .select('id, tenant_id, last_name, first_name, facility_id, role')
        .eq('auth_user_id', user.id)
        .single();
      if (!meData) return;
      setMe(meData as MeRow);

      const tid = meData.tenant_id;

      // 担当施設（manager_facilities + 所属）
      const { data: facs } = await supabase
        .from('manager_facilities')
        .select('facility:facilities(id, name), facility_id')
        .eq('employee_id', meData.id);
      const mfs = (facs || [])
        .map((row: unknown) => {
          const r = row as { facility_id: string; facility: { id: string; name: string } | { id: string; name: string }[] | null };
          const f = Array.isArray(r.facility) ? r.facility[0] : r.facility;
          return { id: r.facility_id, name: f?.name ?? '' };
        })
        .filter((f) => !!f.name);
      const hasAffiliation = mfs.some((f) => f.id === meData.facility_id);
      if (meData.facility_id && !hasAffiliation) {
        const { data: affFac } = await supabase.from('facilities').select('id, name').eq('id', meData.facility_id).single();
        if (affFac) mfs.unshift({ id: affFac.id, name: affFac.name });
      }
      setManagedFacilities(mfs);

      await loadDocs(tid);

      const [catRes, posData] = await Promise.all([
        fetch('/api/categories?type=compliance'),
        supabase.from('positions').select('*').eq('tenant_id', tid).order('display_order'),
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      setPositions((posData.data as Position[]) || []);

      setLoading(false);
    }
    load();
  }, [supabase, loadDocs]);

  function defaultTargetFacilityIds(): string[] {
    if (me?.facility_id && managedFacilities.some((f) => f.id === me.facility_id)) {
      return [me.facility_id];
    }
    return managedFacilities.length > 0 ? [managedFacilities[0].id] : [];
  }

  function openNew() {
    setEditDoc(null);
    setEditTitle('');
    setEditContent('');
    setEditBlocks([]);
    setEditComment('');
    setEditCategoryId(selectedCategory && selectedCategory.id !== 'none' ? selectedCategory.id : null);
    setEditTargetFacilityIds(defaultTargetFacilityIds());
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
    // 既存の配信対象 facility のうち、自分が担当している facility のみ操作可
    const allowed = new Set(managedFacilities.map((f) => f.id));
    const scoped = (doc.target_facility_ids || []).filter((id) => allowed.has(id));
    setEditTargetFacilityIds(scoped.length > 0 ? scoped : defaultTargetFacilityIds());
    setEditOpen(true);
  }

  function toggleFacility(id: string) {
    setEditTargetFacilityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!me || !editTitle.trim()) return;
    if (editBlocks.length === 0 && !editContent.trim()) {
      toast.error('コンテンツを1ブロック以上追加してください');
      return;
    }
    if (editTargetFacilityIds.length === 0) {
      toast.error('配信対象の施設を1つ以上選択してください');
      return;
    }
    setSaving(true);

    if (editDoc) {
      // 更新
      const { error } = await supabase
        .from('compliance_documents')
        .update({
          title: editTitle,
          content: editContent,
          content_blocks: editBlocks,
          admin_comment: editComment || null,
          category_id: editCategoryId,
          target_type: 'facility',
          target_facility_ids: editTargetFacilityIds,
          target_position_ids: [],
          updated_at: new Date().toISOString(),
          updated_by: me.id,
        })
        .eq('id', editDoc.id);
      if (error) { toast.error('保存に失敗しました'); setSaving(false); return; }
      await enqueueNotification('compliance', editDoc.id);
      toast.success('保存しました。社員は再確認が必要になります。2時間後にメール通知されます。');
    } else {
      // 新規作成
      const nextOrder = await nextSortOrder(supabase, 'compliance_documents', me.tenant_id);
      const basePayload: Record<string, unknown> = {
        tenant_id: me.tenant_id,
        title: editTitle,
        content: editContent,
        content_blocks: editBlocks,
        admin_comment: editComment || null,
        category_id: editCategoryId,
        target_type: 'facility',
        target_facility_ids: editTargetFacilityIds,
        target_position_ids: [],
        created_by: me.id,
        updated_by: me.id,
      };
      if (nextOrder !== null) basePayload.sort_order = nextOrder;
      const { data: inserted, error } = await supabase
        .from('compliance_documents')
        .insert(basePayload)
        .select('id')
        .single();
      if (error) { toast.error('作成に失敗しました'); setSaving(false); return; }
      if (inserted) await enqueueNotification('compliance', inserted.id);
      toast.success('遵守事項を作成しました。2時間後に対象社員へメール通知されます。');
    }

    setSaving(false);
    setEditOpen(false);
    await loadDocs(me.tenant_id);
  }

  async function handleDelete(docId: string) {
    if (!confirm('この遵守事項を削除しますか？')) return;
    const { error } = await supabase.from('compliance_documents').delete().eq('id', docId);
    if (error) { toast.error('削除に失敗しました'); return; }
    await cancelNotification('compliance', docId);
    toast.success('削除しました');
    if (me) await loadDocs(me.tenant_id);
  }

  async function openAckStatus(doc: ComplianceDoc) {
    if (!me) return;
    setAckOpen(true);

    const { data: employees } = await supabase
      .from('employees')
      .select('id, last_name, first_name')
      .eq('tenant_id', me.tenant_id)
      .eq('status', 'active')
      .neq('role', 'admin');

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

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  const uncategorizedDocs = docs.filter(d => !d.category_id);
  const catMap = new Map(categories.map(c => [c.id, c]));

  if (!selectedCategory) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h1 className="text-2xl font-bold whitespace-nowrap">遵守事項</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <BulkPublishButtons
              table="compliance_documents"
              items={docs.map((d) => ({ id: d.id, is_published: d.is_published ?? true }))}
              scopeLabel="全体"
              onChanged={() => me && loadDocs(me.tenant_id)}
              restrictedFor="manager"
              currentUserRole={me?.role}
            />
            <CategoryManagerModal type="compliance" onChanged={reloadCategories} />
          </div>
        </div>

        <p className="text-sm text-diletto-gray mb-6">カテゴリを選択して内容を確認・編集してください。新規作成はカテゴリを開いて行います。</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {categories.map((cat) => {
            const catDocs = docs.filter(d => d.category_id === cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat)}
                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
              >
                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                <div className="flex justify-between items-start mb-auto relative">
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                    {cat.icon || '📜'}
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
              onClick={() => setSelectedCategory({ id: 'none', name: 'その他', icon: '📎', color: '#94a3b8' } as Category)}
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
    : docs.filter(d => d.category_id === selectedCategory.id);
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
            table="compliance_documents"
            items={visible.map((d) => ({ id: d.id, is_published: d.is_published ?? true }))}
            scopeLabel="このカテゴリ"
            onChanged={() => me && loadDocs(me.tenant_id)}
          />
          <Button onClick={openNew}>新規作成</Button>
        </div>
      </div>

      <DragSortList
        className="space-y-4"
        onReorder={(from, to) =>
          reorderViaSortColumn('compliance_documents', visible, from, to, () => me && loadDocs(me.tenant_id))
        }
      >
        {visible.map((doc, idx) => {
          const allowed = new Set(managedFacilities.map((f) => f.id));
          const canEdit = (doc.target_facility_ids || []).some((id) => allowed.has(id));
          return (
            <DragSortItem key={doc.id} index={idx}>
              {(handle) => (
            <Card className="rounded-lg shadow-sm border-diletto-gray/5 overflow-hidden" style={{ background: handle.isDropTarget ? 'var(--accent-pale)' : undefined }}>
              <CardHeader className="py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <DragHandleIcon {...handle} />
                  <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                    <CardTitle className="text-base font-bold text-diletto-ink break-words md:truncate">{doc.title || '（無題）'}</CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <PersonInline label="作成者" person={doc.creator} />
                      {doc.created_by !== doc.updated_by && <PersonInline label="編集者" person={doc.editor} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap order-2 md:order-none">
                    <NewBadge createdAt={doc.created_at || doc.updated_at} />
                    <CategoryBadge category={doc.category_id ? catMap.get(doc.category_id) : null} />
                  </div>
                  <div className="flex gap-2 flex-wrap order-3 md:order-none">
                    {canEdit && (
                      <PublishToggleButton
                        table="compliance_documents"
                        id={doc.id}
                        isPublished={doc.is_published ?? true}
                        onChanged={() => me && loadDocs(me.tenant_id)}
                      />
                    )}
                    <Button variant="outline" size="sm" onClick={() => openAckStatus(doc)} className="h-8 rounded-md text-xs font-bold">
                      同意状況
                    </Button>
                    {canEdit && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => openEdit(doc)} className="h-8 rounded-md text-xs font-bold">
                          編集
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 rounded-md text-xs font-bold text-diletto-red" onClick={() => handleDelete(doc.id)}>
                          削除
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="whitespace-pre-wrap text-sm leading-relaxed border border-diletto-gray/10 rounded-lg p-3 bg-gray-50/50 max-h-40 overflow-y-auto custom-scrollbar">
                  {doc.content}
                </div>
                {doc.admin_comment && (
                  <div className="text-sm text-diletto-gray mt-3 border-l-4 border-diletto-blue/30 pl-3 italic bg-diletto-blue/[0.02] py-2 rounded-r-lg">
                    {doc.admin_comment}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <p className="text-[10px] text-diletto-gray-light font-medium">
                    最終更新: {new Date(doc.updated_at).toLocaleString('ja-JP')}
                  </p>
                  <TargetAttributeBadges
                    targetType={doc.target_type}
                    targetFacilityIds={doc.target_facility_ids}
                    targetPositionIds={doc.target_position_ids}
                    facilities={managedFacilities as never[]}
                    positions={positions}
                  />
                </div>
              </CardContent>
            </Card>
              )}
            </DragSortItem>
          );
        })}
        {visible.length === 0 && (
          <Card><CardContent className="py-12 text-center text-diletto-gray-light">該当する遵守事項はありません</CardContent></Card>
        )}
      </DragSortList>

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
            {/* 1. 配信対象 (manager は自管轄施設のみ) */}
            <div className="space-y-2">
              <Label>配信対象の施設 *</Label>
              <div className="flex flex-wrap gap-2">
                {managedFacilities.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFacility(f.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border ${editTargetFacilityIds.includes(f.id)
                      ? 'bg-diletto-blue text-white border-diletto-blue shadow-sm'
                      : 'bg-white text-diletto-gray border-diletto-gray/15 hover:border-diletto-blue/30'
                      }`}
                  >
                    {f.name}
                    {me?.facility_id === f.id && <span className="ml-1 opacity-60 text-[10px]">(所属)</span>}
                  </button>
                ))}
              </div>
            </div>
            {/* 2. タイトル */}
            <div className="space-y-2">
              <Label>タイトル *</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="例: 個人情報保護方針" />
            </div>
            {/* 3. コンテンツブロック */}
            <div className="space-y-2">
              <Label>コンテンツブロック（文章・画像・動画・PDF）*</Label>
              <BlockEditor tenantId={me?.tenant_id ?? null} blocks={editBlocks} onChange={setEditBlocks} storagePrefix="compliance" />
            </div>
            {/* 4. カテゴリ */}
            <CategorySelect
              type="compliance"
              value={editCategoryId}
              onChange={setEditCategoryId}
              label="カテゴリ（任意）"
            />
            {/* 5. 管理者コメント */}
            <div className="space-y-2">
              <Label>管理者コメント（任意）</Label>
              <Textarea value={editComment} onChange={(e) => setEditComment(e.target.value)} rows={3} placeholder="補足コメント" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave} disabled={saving || !editTitle.trim() || editBlocks.length === 0 || editTargetFacilityIds.length === 0}>
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
          <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
            {acks.length === 0 ? (
              <p className="text-sm text-diletto-gray py-4 text-center">対象の社員はいません</p>
            ) : (
              acks.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-diletto-gray/5 last:border-0 px-1">
                  <span className="text-sm font-medium">{a.employee_name}</span>
                  {a.acknowledged ? (
                    <Badge className="bg-diletto-green/10 text-diletto-green border-none">同意済</Badge>
                  ) : (
                    <Badge className="bg-diletto-red/[0.06] text-diletto-red border-none">未同意</Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
