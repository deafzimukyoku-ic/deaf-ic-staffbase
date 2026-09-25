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
import { CategoryBadge, CategorySelect } from '@/components/admin/CategorySelect';
import { CategoryManagerModal } from '@/components/admin/CategoryManagerModal';
import { NewBadge } from '@/components/admin/NewBadge';
import { PersonInline } from '@/components/admin/PersonInline';
import { enqueueNotification } from '@/lib/notifications/queue';
import { DragSortList, DragSortItem, DragHandleIcon, reorderViaSortColumn } from '@/components/admin/DragSortList';
import { nextSortOrder } from '@/lib/sort-helpers';
import { BlockEditor, type ContentBlock } from '@/components/admin/BlockEditor';
import { PublishToggleButton } from '@/components/admin/PublishToggleButton';
import { BulkPublishButtons } from '@/components/admin/BulkPublishButtons';
import { TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { buildStoragePath } from '@/lib/upload-helpers';
import { toast } from 'sonner';
import type { Manual, Category, Position } from '@/lib/types';

interface MeRow {
    id: string;
    tenant_id: string;
    last_name: string;
    first_name: string;
    facility_id: string | null;
    role: string;
}

export default function ManagerManualsPage() {
    const [me, setMe] = useState<MeRow | null>(null);
    const [manuals, setManuals] = useState<Manual[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
    const [managedFacilities, setManagedFacilities] = useState<{ id: string; name: string }[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [editingManual, setEditingManual] = useState<Manual | null>(null);

    const [form, setForm] = useState<{
        title: string;
        body: string;
        category_id: string;
        target_facility_ids: string[];
        pdf_storage_path: string | null;
    }>({ title: '', body: '', category_id: '', target_facility_ids: [], pdf_storage_path: null });
    const [blocks, setBlocks] = useState<ContentBlock[]>([]);

    const supabase = createClient();

    /* カテゴリだけ再 fetch（CategoryManagerModal でカテゴリ追加・編集・削除されたとき用） */
    const reloadCategories = useCallback(async () => {
        const catRes = await fetch('/api/categories?type=manual');
        if (catRes.ok) setCategories(await catRes.json());
    }, []);

    const reloadManuals = useCallback(async (tid: string) => {
        const { data } = await supabase
            .from('manuals')
            .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
            .eq('tenant_id', tid)
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });
        setManuals((data as Manual[]) || []);
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

            await reloadManuals(tid);

            const [catRes, posData] = await Promise.all([
                fetch('/api/categories?type=manual'),
                supabase.from('positions').select('*').eq('tenant_id', tid).order('display_order'),
            ]);

            if (catRes.ok) setCategories(await catRes.json());
            setPositions((posData.data as Position[]) || []);

            setLoading(false);
        }
        load();
    }, [supabase, reloadManuals]);

    function defaultTargetFacilityIds(): string[] {
        if (me?.facility_id && managedFacilities.some((f) => f.id === me.facility_id)) {
            return [me.facility_id];
        }
        return managedFacilities.length > 0 ? [managedFacilities[0].id] : [];
    }

    function openNew() {
        setEditingManual(null);
        setBlocks([]);
        setPdfFile(null);
        setForm({
            title: '',
            body: '',
            category_id: selectedCategory && selectedCategory.id !== 'none' ? selectedCategory.id : '',
            target_facility_ids: defaultTargetFacilityIds(),
            pdf_storage_path: null,
        });
        setDialogOpen(true);
    }

    function openEdit(m: Manual) {
        setEditingManual(m);
        setBlocks(Array.isArray(m.content_blocks) ? m.content_blocks as ContentBlock[] : []);
        setPdfFile(null);
        const allowed = new Set(managedFacilities.map((f) => f.id));
        const scoped = (m.target_facility_ids || []).filter((id) => allowed.has(id));
        setForm({
            title: m.title,
            body: m.body || '',
            category_id: m.category_id || '',
            target_facility_ids: scoped.length > 0 ? scoped : defaultTargetFacilityIds(),
            pdf_storage_path: m.pdf_storage_path || null,
        });
        setDialogOpen(true);
    }

    const handleSave = async () => {
        if (!me || !form.title.trim()) return;
        if (!form.body.trim() && !pdfFile && !form.pdf_storage_path && blocks.length === 0) {
            toast.error('本文・PDF・コンテンツブロックのいずれかを入力してください');
            return;
        }
        if (form.target_facility_ids.length === 0) {
            toast.error('配信対象の施設を1つ以上選択してください');
            return;
        }
        setSaving(true);

        try {
            let pdfPath: string | null = form.pdf_storage_path;
            if (pdfFile) {
                pdfPath = buildStoragePath('manuals', me.tenant_id, pdfFile.name);
                const { error: upErr } = await supabase.storage.from('documents').upload(pdfPath, pdfFile, {
                    contentType: 'application/pdf',
                });
                if (upErr) throw upErr;
            }

            const payload = {
                tenant_id: me.tenant_id,
                title: form.title.trim(),
                body: form.body.trim(),
                content_blocks: blocks,
                pdf_storage_path: pdfPath,
                category_id: form.category_id || null,
                target_type: 'facility' as const,
                target_facility_ids: form.target_facility_ids,
                target_position_ids: [] as string[],
            };

            if (editingManual) {
                const { error } = await supabase
                    .from('manuals')
                    .update({ ...payload, updated_by: me.id })
                    .eq('id', editingManual.id);
                if (error) throw error;
                toast.success('業務マニュアルを更新しました');
            } else {
                const nextOrder = await nextSortOrder(supabase, 'manuals', me.tenant_id);
                const insertPayload: Record<string, unknown> = { ...payload, created_by: me.id, updated_by: me.id };
                if (nextOrder !== null) insertPayload.sort_order = nextOrder;
                const { data: inserted, error } = await supabase
                    .from('manuals')
                    .insert(insertPayload)
                    .select('id')
                    .single();
                if (error) throw error;
                if (inserted?.id) await enqueueNotification('manual', inserted.id);
                toast.success('業務マニュアルを投稿しました。2時間後に対象社員へメール通知されます。');
            }

            await reloadManuals(me.tenant_id);
            setDialogOpen(false);
            setEditingManual(null);
            setBlocks([]);
            setPdfFile(null);
            setForm({ title: '', body: '', category_id: '', target_facility_ids: [], pdf_storage_path: null });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error('保存に失敗しました', { description: msg });
        } finally {
            setSaving(false);
        }
    };

    async function handleDelete(id: string) {
        if (!confirm('この業務マニュアルを削除しますか？')) return;
        const { error } = await supabase.from('manuals').delete().eq('id', id);
        if (error) { toast.error('削除に失敗しました'); return; }
        toast.success('削除しました');
        if (me) await reloadManuals(me.tenant_id);
    }

    const toggleFacility = (id: string) => {
        setForm(prev => ({
            ...prev,
            target_facility_ids: prev.target_facility_ids.includes(id)
                ? prev.target_facility_ids.filter(fid => fid !== id)
                : [...prev.target_facility_ids, id]
        }));
    };

    if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /></div>;

    const uncategorizedDocs = manuals.filter(d => !d.category_id);
    const catMap = new Map(categories.map(c => [c.id, c]));

    if (!selectedCategory) {
        return (
            <div>
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold whitespace-nowrap">業務マニュアル</h1>
                    <div className="flex items-center gap-2 flex-wrap">
                        <BulkPublishButtons
                            table="manuals"
                            items={manuals.map((m) => ({ id: m.id, is_published: m.is_published ?? true }))}
                            scopeLabel="全体"
                            onChanged={() => me && reloadManuals(me.tenant_id)}
                            restrictedFor="manager"
                            currentUserRole={me?.role}
                        />
                        <CategoryManagerModal type="manual" onChanged={reloadCategories} />
                    </div>
                </div>

                <p className="text-sm text-diletto-gray mb-6">カテゴリを選択して内容を確認・投稿してください。新規投稿はカテゴリを開いて行います。</p>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {categories.map((cat) => {
                        const catDocs = manuals.filter(d => d.category_id === cat.id);
                        return (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat)}
                                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-diletto-gray/5 hover:border-diletto-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
                            >
                                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                                <div className="flex justify-between items-start mb-auto relative">
                                    <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                                        {cat.icon || '📖'}
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

    const visible = selectedCategory.id === 'none'
        ? uncategorizedDocs
        : manuals.filter(d => d.category_id === selectedCategory.id);

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
                        table="manuals"
                        items={visible.map((m) => ({ id: m.id, is_published: m.is_published ?? true }))}
                        scopeLabel="このカテゴリ"
                        onChanged={() => me && reloadManuals(me.tenant_id)}
                    />
                    <Button onClick={openNew} className="bg-diletto-ink hover:bg-black text-white rounded-xl h-11 font-bold px-8 shadow-sm transition-all hover:shadow-md">
                        + 新規投稿
                    </Button>
                </div>
            </div>

            <DragSortList
                className="space-y-4"
                onReorder={(from, to) =>
                    reorderViaSortColumn('manuals', visible, from, to, () => me && reloadManuals(me.tenant_id))
                }
            >
                {visible.map((m, idx) => {
                    const allowed = new Set(managedFacilities.map((f) => f.id));
                    const canEdit = (m.target_facility_ids || []).some((id) => allowed.has(id));
                    return (
                        <DragSortItem key={m.id} index={idx}>
                            {(handle) => (
                        <Card className="border-diletto-gray/5 shadow-sm rounded-xl overflow-hidden hover:border-diletto-blue/20 transition-all bg-white" style={{ background: handle.isDropTarget ? 'var(--accent-pale)' : undefined }}>
                            <CardContent className="py-6">
                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                    <DragHandleIcon {...handle} />
                                    <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                                        <p className="font-bold text-diletto-ink text-lg break-words md:truncate">{m.title}</p>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <PersonInline label="作成者" person={m.creator} />
                                            {m.created_by !== m.updated_by && <PersonInline label="編集者" person={m.editor} />}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap order-2 md:order-none">
                                        <NewBadge createdAt={m.created_at} />
                                        <CategoryBadge category={m.category_id ? catMap.get(m.category_id) : null} />
                                        {m.pdf_storage_path && (
                                            <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">📄 PDF</span>
                                        )}
                                        <p className="text-xs text-diletto-gray-light font-medium ml-2">
                                            {new Date(m.created_at).toLocaleDateString('ja-JP')}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap order-3 md:order-none">
                                        {canEdit && (
                                            <>
                                                <PublishToggleButton
                                                    table="manuals"
                                                    id={m.id}
                                                    isPublished={m.is_published ?? true}
                                                    onChanged={() => me && reloadManuals(me.tenant_id)}
                                                />
                                                <Button variant="ghost" size="sm" onClick={() => openEdit(m)} className="h-8 rounded-md text-xs font-bold">編集</Button>
                                                <Button variant="outline" size="sm" className="h-8 rounded-md text-xs font-bold text-diletto-red" onClick={() => handleDelete(m.id)}>削除</Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {m.body && <p className="text-sm text-diletto-gray mb-4 whitespace-pre-wrap line-clamp-3 leading-relaxed">{m.body}</p>}
                                <div className="pt-4 border-t border-diletto-gray/5">
                                    <TargetAttributeBadges
                                        targetType={m.target_type}
                                        targetFacilityIds={m.target_facility_ids}
                                        targetPositionIds={m.target_position_ids}
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
                    <Card className="border-dashed border-2 border-diletto-gray/10 bg-transparent rounded-3xl">
                        <CardContent className="py-20 text-center text-diletto-gray-light font-medium">
                            該当する業務マニュアルはありません
                        </CardContent>
                    </Card>
                )}
            </DragSortList>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingManual ? '業務マニュアルの編集' : '業務マニュアルの追加'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                        {/* 1. 配信対象 */}
                        <div className="space-y-2">
                            <Label>配信対象の施設 *</Label>
                            <div className="flex flex-wrap gap-2">
                                {managedFacilities.map((f) => (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => toggleFacility(f.id)}
                                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border ${form.target_facility_ids.includes(f.id)
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
                            <Input
                                placeholder="業務マニュアルのタイトル"
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                            />
                        </div>
                        {/* 3. 補足説明 */}
                        <div className="space-y-2">
                            <Label>補足説明（任意）</Label>
                            <Textarea
                                placeholder="マニュアルの概要を1〜数行で"
                                rows={3}
                                value={form.body}
                                onChange={(e) => setForm({ ...form, body: e.target.value })}
                            />
                        </div>
                        {/* 4. コンテンツブロック */}
                        <div className="space-y-2">
                            <Label>コンテンツブロック（文章・画像・動画・PDF）</Label>
                            <BlockEditor tenantId={me?.tenant_id ?? null} blocks={blocks} onChange={setBlocks} storagePrefix="manuals" />
                        </div>
                        {/* 5. カテゴリ */}
                        <CategorySelect
                            type="manual"
                            value={form.category_id || null}
                            onChange={(id) => setForm({ ...form, category_id: id || '' })}
                            label="カテゴリ（任意）"
                        />
                        {/* 6. PDF 添付（マニュアル特有・任意） */}
                        <div className="space-y-2">
                            <Label>PDF 添付（任意）</Label>
                            <Input
                                type="file"
                                accept="application/pdf"
                                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                            />
                            {pdfFile && <p className="text-xs text-diletto-gray">選択中: {pdfFile.name}</p>}
                            {!pdfFile && form.pdf_storage_path && (
                                <p className="text-[11px] text-diletto-gray-light">既存 PDF: {form.pdf_storage_path.split('/').pop()}</p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDialogOpen(false); setPdfFile(null); }}>キャンセル</Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving || !form.title.trim() || form.target_facility_ids.length === 0}
                        >
                            {saving ? '保存中...' : '保存'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
