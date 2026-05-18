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
import { DragSortList, DragSortItem, DragHandleIcon, reorderViaSortColumn } from '@/components/admin/DragSortList';
import { nextSortOrder } from '@/lib/sort-helpers';
import { BlockEditor, type ContentBlock } from '@/components/admin/BlockEditor';
import { PublishToggleButton } from '@/components/admin/PublishToggleButton';
import { BulkPublishButtons } from '@/components/admin/BulkPublishButtons';
import { TargetAttributeBadges } from '@/components/admin/AttributeTargetSelector';
import { enqueueNotification, cancelNotification } from '@/lib/notifications/queue';
import { toast } from 'sonner';
import type { Announcement, Category, Position } from '@/lib/types';

interface MeRow {
    id: string;
    tenant_id: string;
    last_name: string;
    first_name: string;
    facility_id: string | null;
    role: string;
}

export default function ManagerAnnouncementsPage() {
    const [me, setMe] = useState<MeRow | null>(null);
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
    const [managedFacilities, setManagedFacilities] = useState<{ id: string; name: string }[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);

    const [form, setForm] = useState<{
        title: string;
        body: string;
        category_id: string;
        target_facility_ids: string[];
    }>({ title: '', body: '', category_id: '', target_facility_ids: [] });
    const [blocks, setBlocks] = useState<ContentBlock[]>([]);

    const supabase = createClient();

    /* カテゴリだけ再 fetch（CategoryManagerModal でカテゴリ追加・編集・削除されたとき用） */
    const reloadCategories = useCallback(async () => {
        const catRes = await fetch('/api/categories?type=announcement');
        if (catRes.ok) setCategories(await catRes.json());
    }, []);

    const reloadAnnouncements = useCallback(async (tid: string) => {
        const { data } = await supabase
            .from('announcements')
            .select('*, creator:employees!created_by(last_name, first_name, email), editor:employees!updated_by(last_name, first_name, email)')
            .eq('tenant_id', tid)
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });
        setAnnouncements((data as Announcement[]) || []);
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

            await reloadAnnouncements(tid);

            const [catRes, posData] = await Promise.all([
                fetch('/api/categories?type=announcement'),
                supabase.from('positions').select('*').eq('tenant_id', tid).order('display_order'),
            ]);

            if (catRes.ok) setCategories(await catRes.json());
            setPositions((posData.data as Position[]) || []);

            setLoading(false);
        }
        load();
    }, [supabase, reloadAnnouncements]);

    function defaultTargetFacilityIds(): string[] {
        if (me?.facility_id && managedFacilities.some((f) => f.id === me.facility_id)) {
            return [me.facility_id];
        }
        return managedFacilities.length > 0 ? [managedFacilities[0].id] : [];
    }

    function openNew() {
        setEditingAnnouncement(null);
        setBlocks([]);
        setForm({
            title: '',
            body: '',
            category_id: selectedCategory && selectedCategory.id !== 'none' ? selectedCategory.id : '',
            target_facility_ids: defaultTargetFacilityIds(),
        });
        setDialogOpen(true);
    }

    function openEdit(a: Announcement) {
        setEditingAnnouncement(a);
        setBlocks(Array.isArray(a.content_blocks) ? a.content_blocks as ContentBlock[] : []);
        const allowed = new Set(managedFacilities.map((f) => f.id));
        const scoped = (a.target_facility_ids || []).filter((id) => allowed.has(id));
        setForm({
            title: a.title,
            body: a.body || '',
            category_id: a.category_id || '',
            target_facility_ids: scoped.length > 0 ? scoped : defaultTargetFacilityIds(),
        });
        setDialogOpen(true);
    }

    const handleSave = async () => {
        if (!me || !form.title.trim() || !form.body.trim()) return;
        if (form.target_facility_ids.length === 0) {
            toast.error('配信対象の施設を1つ以上選択してください');
            return;
        }
        setSaving(true);

        try {
            const payload = {
                tenant_id: me.tenant_id,
                title: form.title.trim(),
                body: form.body.trim(),
                content_blocks: blocks,
                category_id: form.category_id || null,
                target_type: 'facility' as const,
                target_facility_ids: form.target_facility_ids,
                target_position_ids: [] as string[],
            };

            if (editingAnnouncement) {
                const { error } = await supabase
                    .from('announcements')
                    .update({ ...payload, updated_by: me.id })
                    .eq('id', editingAnnouncement.id);
                if (error) throw error;
                toast.success('お知らせを更新しました');
            } else {
                const nextOrder = await nextSortOrder(supabase, 'announcements', me.tenant_id);
                const insertPayload: Record<string, unknown> = { ...payload, created_by: me.id, updated_by: me.id };
                if (nextOrder !== null) insertPayload.sort_order = nextOrder;
                const { data, error } = await supabase
                    .from('announcements')
                    .insert(insertPayload)
                    .select('id')
                    .single();
                if (error) throw error;

                if (data) await enqueueNotification('announcement', data.id);

                await fetch('/api/notifications/manager-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tenant_id: me.tenant_id,
                        manager_name: `${me.last_name} ${me.first_name}`,
                        action_type: 'お知らせの新規投稿',
                        action_details: `タイトル: ${form.title.trim()}\n対象施設: ${managedFacilities.filter(f => form.target_facility_ids.includes(f.id)).map(f => f.name).join(', ')}`,
                    }),
                });

                toast.success('お知らせを投稿しました');
            }

            await reloadAnnouncements(me.tenant_id);
            setDialogOpen(false);
            setEditingAnnouncement(null);
            setBlocks([]);
            setForm({ title: '', body: '', category_id: '', target_facility_ids: [] });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error('保存に失敗しました', { description: msg });
        } finally {
            setSaving(false);
        }
    };

    async function handleDelete(id: string) {
        if (!confirm('このお知らせを削除しますか？')) return;
        const { error } = await supabase.from('announcements').delete().eq('id', id);
        if (error) { toast.error('削除に失敗しました'); return; }
        await cancelNotification('announcement', id);
        toast.success('削除しました');
        if (me) await reloadAnnouncements(me.tenant_id);
    }

    const toggleFacility = (id: string) => {
        setForm(prev => ({
            ...prev,
            target_facility_ids: prev.target_facility_ids.includes(id)
                ? prev.target_facility_ids.filter(fid => fid !== id)
                : [...prev.target_facility_ids, id]
        }));
    };

    if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /></div>;

    const uncategorizedDocs = announcements.filter(d => !d.category_id);
    const catMap = new Map(categories.map(c => [c.id, c]));

    if (!selectedCategory) {
        return (
            <div>
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold whitespace-nowrap">お知らせ</h1>
                    <div className="flex items-center gap-2 flex-wrap">
                        <BulkPublishButtons
                            table="announcements"
                            items={announcements.map((a) => ({ id: a.id, is_published: a.is_published ?? true }))}
                            scopeLabel="全体"
                            onChanged={() => me && reloadAnnouncements(me.tenant_id)}
                            restrictedFor="manager"
                            currentUserRole={me?.role}
                        />
                        <CategoryManagerModal type="announcement" onChanged={reloadCategories} />
                    </div>
                </div>

                <p className="text-sm text-brand-gray mb-6">カテゴリを選択して内容を確認・投稿してください。新規投稿はカテゴリを開いて行います。</p>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {categories.map((cat) => {
                        const catDocs = announcements.filter(d => d.category_id === cat.id);
                        return (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat)}
                                className="relative flex flex-col p-4 bg-white rounded-2xl shadow-sm border border-brand-gray/5 hover:border-brand-blue/30 hover:shadow-md transition-all group overflow-hidden h-[140px] text-left"
                            >
                                <div className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity" style={{ backgroundColor: cat.color }} />
                                <div className="flex justify-between items-start mb-auto relative">
                                    <span className="text-3xl group-hover:scale-110 transition-transform duration-300">
                                        {cat.icon || '📢'}
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
                            onClick={() => setSelectedCategory({ id: 'none', name: 'その他', icon: '📎', color: '#94a3b8' } as Category)}
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
        : announcements.filter(d => d.category_id === selectedCategory.id);
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
                        table="announcements"
                        items={visible.map((a) => ({ id: a.id, is_published: a.is_published ?? true }))}
                        scopeLabel="このカテゴリ"
                        onChanged={() => me && reloadAnnouncements(me.tenant_id)}
                    />
                    <Button onClick={openNew} className="bg-brand-ink hover:bg-black text-white rounded-xl h-11 font-bold px-8 shadow-sm transition-all hover:shadow-md">
                        + 新規投稿
                    </Button>
                </div>
            </div>

            <DragSortList
                className="space-y-4"
                onReorder={(from, to) =>
                    reorderViaSortColumn('announcements', visible, from, to, () => me && reloadAnnouncements(me.tenant_id))
                }
            >
                {visible.map((a, idx) => {
                    const allowed = new Set(managedFacilities.map((f) => f.id));
                    const canEdit = (a.target_facility_ids || []).some((id) => allowed.has(id));
                    return (
                        <DragSortItem key={a.id} index={idx}>
                            {(handle) => (
                        <Card className="border-brand-gray/5 shadow-sm rounded-xl overflow-hidden hover:border-brand-blue/20 transition-all bg-white" style={{ background: handle.isDropTarget ? 'var(--accent-pale)' : undefined }}>
                            <CardContent className="py-6">
                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                    <DragHandleIcon {...handle} />
                                    <div className="min-w-0 basis-full md:basis-0 md:flex-1 order-1 md:order-none">
                                        <p className="font-bold text-brand-ink text-lg break-words md:truncate">{a.title}</p>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <PersonInline label="作成者" person={a.creator} />
                                            {a.created_by !== a.updated_by && <PersonInline label="編集者" person={a.editor} />}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap order-2 md:order-none">
                                        <NewBadge createdAt={a.created_at} />
                                        <CategoryBadge category={a.category_id ? catMap.get(a.category_id) : null} />
                                        <p className="text-xs text-brand-gray-light font-medium ml-2">
                                            {new Date(a.created_at).toLocaleDateString('ja-JP')}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap order-3 md:order-none">
                                        {canEdit && (
                                            <>
                                                <PublishToggleButton
                                                    table="announcements"
                                                    id={a.id}
                                                    isPublished={a.is_published ?? true}
                                                    onChanged={() => me && reloadAnnouncements(me.tenant_id)}
                                                />
                                                <Button variant="ghost" size="sm" onClick={() => openEdit(a)} className="h-8 rounded-md text-xs font-bold">編集</Button>
                                                <Button variant="outline" size="sm" className="h-8 rounded-md text-xs font-bold text-brand-red" onClick={() => handleDelete(a.id)}>削除</Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <p className="text-sm text-brand-gray mb-4 whitespace-pre-wrap line-clamp-3 leading-relaxed">{a.body}</p>
                                <div className="pt-4 border-t border-brand-gray/5">
                                    <TargetAttributeBadges
                                        targetType={a.target_type}
                                        targetFacilityIds={a.target_facility_ids}
                                        targetPositionIds={a.target_position_ids}
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
                    <Card className="border-dashed border-2 border-brand-gray/10 bg-transparent rounded-3xl">
                        <CardContent className="py-20 text-center text-brand-gray-light font-medium">
                            該当するお知らせはありません
                        </CardContent>
                    </Card>
                )}
            </DragSortList>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingAnnouncement ? 'お知らせの編集' : 'お知らせの追加'}</DialogTitle>
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
                                            ? 'bg-brand-blue text-white border-brand-blue shadow-sm'
                                            : 'bg-white text-brand-gray border-brand-gray/15 hover:border-brand-blue/30'
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
                                placeholder="重要なご連絡、イベント告知など"
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                            />
                        </div>
                        {/* 3. 補足説明 (任意・短文) */}
                        <div className="space-y-2">
                            <Label>補足説明（任意）</Label>
                            <Textarea
                                placeholder="お知らせの概要を1〜数行で"
                                rows={3}
                                value={form.body}
                                onChange={(e) => setForm({ ...form, body: e.target.value })}
                            />
                        </div>
                        {/* 4. コンテンツブロック */}
                        <div className="space-y-2">
                            <Label>コンテンツブロック（文章・画像・動画・PDF）</Label>
                            <BlockEditor tenantId={me?.tenant_id ?? null} blocks={blocks} onChange={setBlocks} storagePrefix="announcements" />
                        </div>
                        {/* 5. カテゴリ */}
                        <CategorySelect
                            type="announcement"
                            value={form.category_id || null}
                            onChange={(id) => setForm({ ...form, category_id: id || '' })}
                            label="カテゴリ（任意）"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
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
