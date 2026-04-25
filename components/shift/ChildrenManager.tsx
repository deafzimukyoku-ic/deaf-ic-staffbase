'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ReorderButtons } from '@/components/admin/ReorderButtons';
import { AreaEditor } from '@/components/shift/AreaEditor';
import { GRADE_LABELS, GRADE_TYPES, GRADE_GROUPS, type GradeType, type GradeGroupKey } from '@/lib/constants';
import type { ChildRow, Facility, AreaLabel } from '@/lib/types';

interface Props {
  scope: 'admin' | 'manager';
}

interface MeRow {
  id: string;
  tenant_id: string;
  facility_id: string | null;
}

type EditForm = {
  name: string;
  grade_type: GradeType;
  facility_id: string;
  is_active: boolean;
  parent_contact: string;
  home_address: string;
  custom_pickup_areas: AreaLabel[];
  custom_dropoff_areas: AreaLabel[];
  pickup_area_labels: string[];
  dropoff_area_labels: string[];
};

const EMPTY_FORM: EditForm = {
  name: '',
  grade_type: 'elementary_1',
  facility_id: '',
  is_active: true,
  parent_contact: '',
  home_address: '',
  custom_pickup_areas: [],
  custom_dropoff_areas: [],
  pickup_area_labels: [],
  dropoff_area_labels: [],
};

export function ChildrenManager({ scope }: Props) {
  const supabase = createClient();
  const [me, setMe] = useState<MeRow | null>(null);
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // フィルタ
  const [facilityFilter, setFacilityFilter] = useState<string>('all');
  const [gradeGroup, setGradeGroup] = useState<GradeGroupKey>('all');
  const [showRetired, setShowRetired] = useState(false);

  // 編集ダイアログ
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);

  const loadAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: meData } = await supabase
      .from('employees')
      .select('id, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (!meData) return;
    setMe(meData as MeRow);

    const tid = meData.tenant_id;

    // facilities 一覧（admin は全、manager は自facility のみ表示されるが念のため全取得）
    const { data: facData } = await supabase
      .from('facilities')
      .select('id, name, tenant_id, address, created_at')
      .eq('tenant_id', tid)
      .order('created_at');
    const allFacs = (facData as Facility[]) || [];
    const scopedFacs = scope === 'manager' && meData.facility_id
      ? allFacs.filter((f) => f.id === meData.facility_id)
      : allFacs;
    setFacilities(scopedFacs);

    // children 一覧（RLS で manager は自facility のみ返る）
    const { data: childData, error } = await supabase
      .from('children')
      .select('*')
      .eq('tenant_id', tid)
      .order('display_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('児童一覧の取得に失敗しました', { description: error.message });
    }
    setChildren((childData as ChildRow[]) || []);

    setLoading(false);
  }, [supabase, scope]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // フィルタリング
  const visibleChildren = useMemo(() => {
    let list = children;
    if (!showRetired) list = list.filter((c) => c.is_active);
    if (facilityFilter !== 'all') list = list.filter((c) => c.facility_id === facilityFilter);
    if (gradeGroup !== 'all') {
      const targets = new Set<GradeType>(GRADE_GROUPS[gradeGroup].grades);
      list = list.filter((c) => targets.has(c.grade_type));
    }
    return list;
  }, [children, showRetired, facilityFilter, gradeGroup]);

  const facilityMap = useMemo(() => {
    const m = new Map<string, Facility>();
    for (const f of facilities) m.set(f.id, f);
    return m;
  }, [facilities]);

  function openNew() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      facility_id:
        scope === 'manager' && me?.facility_id
          ? me.facility_id
          : (facilityFilter !== 'all' ? facilityFilter : (facilities[0]?.id ?? '')),
    });
    setEditOpen(true);
  }

  function openEdit(c: ChildRow) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      grade_type: c.grade_type,
      facility_id: c.facility_id,
      is_active: c.is_active,
      parent_contact: c.parent_contact ?? '',
      home_address: c.home_address ?? '',
      custom_pickup_areas: Array.isArray(c.custom_pickup_areas) ? c.custom_pickup_areas : [],
      custom_dropoff_areas: Array.isArray(c.custom_dropoff_areas) ? c.custom_dropoff_areas : [],
      pickup_area_labels: c.pickup_area_labels ?? [],
      dropoff_area_labels: c.dropoff_area_labels ?? [],
    });
    setEditOpen(true);
  }

  async function nextDisplayOrder(tid: string, facId: string): Promise<number> {
    const { data } = await supabase
      .from('children')
      .select('display_order')
      .eq('tenant_id', tid)
      .eq('facility_id', facId)
      .order('display_order', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const max = (data as { display_order?: number | null } | null)?.display_order ?? 0;
    return max + 1;
  }

  async function handleSave() {
    if (!me) return;
    if (!form.name.trim()) { toast.error('氏名を入力してください'); return; }
    if (!form.facility_id) { toast.error('所属事業所を選択してください'); return; }
    setSaving(true);

    const payload = {
      tenant_id: me.tenant_id,
      facility_id: form.facility_id,
      name: form.name.trim(),
      grade_type: form.grade_type,
      is_active: form.is_active,
      parent_contact: form.parent_contact.trim() || null,
      home_address: form.home_address.trim() || null,
      custom_pickup_areas: form.custom_pickup_areas,
      custom_dropoff_areas: form.custom_dropoff_areas,
      pickup_area_labels: form.pickup_area_labels,
      dropoff_area_labels: form.dropoff_area_labels,
    };

    if (editingId) {
      const { error } = await supabase.from('children').update(payload).eq('id', editingId);
      if (error) { toast.error('保存に失敗しました', { description: error.message }); setSaving(false); return; }
      toast.success('児童情報を更新しました');
    } else {
      const order = await nextDisplayOrder(me.tenant_id, form.facility_id);
      const { error } = await supabase.from('children').insert({ ...payload, display_order: order });
      if (error) { toast.error('登録に失敗しました', { description: error.message }); setSaving(false); return; }
      toast.success('児童を登録しました');
    }

    setSaving(false);
    setEditOpen(false);
    await loadAll();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`${name} を削除しますか？関連する利用予定・送迎割当もすべて削除されます。`)) return;
    const { error } = await supabase.from('children').delete().eq('id', id);
    if (error) { toast.error('削除に失敗しました', { description: error.message }); return; }
    toast.success('削除しました');
    await loadAll();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-diletto-gray">読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-3xl">👶</span>
          <h1 className="text-2xl font-bold text-diletto-ink">児童管理</h1>
          <span className="text-sm text-diletto-gray-light">{visibleChildren.length} 人</span>
        </div>
        <Button onClick={openNew}>+ 児童を追加</Button>
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-md border border-diletto-gray/10 p-3">
        {scope === 'admin' && facilities.length > 1 && (
          <div className="flex items-center gap-2">
            <Label className="text-[10px] font-bold text-diletto-gray-light uppercase">事業所</Label>
            <select
              value={facilityFilter}
              onChange={(e) => setFacilityFilter(e.target.value)}
              className="h-9 rounded-md border border-diletto-gray/15 bg-white px-3 text-sm"
              aria-label="事業所フィルタ"
            >
              <option value="all">すべて</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1 flex-wrap">
          {(Object.keys(GRADE_GROUPS) as GradeGroupKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setGradeGroup(key)}
              className={`px-3 h-9 rounded-md text-xs font-bold border transition-all ${
                gradeGroup === key
                  ? 'bg-diletto-ink text-white border-diletto-ink'
                  : 'bg-white text-diletto-gray border-diletto-gray/15 hover:border-diletto-ink/30'
              }`}
            >
              {GRADE_GROUPS[key].label}
            </button>
          ))}
        </div>

        <label className="ml-auto flex items-center gap-2 text-xs text-diletto-gray cursor-pointer">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
            className="h-4 w-4 accent-diletto-blue"
          />
          退所児童も表示
        </label>
      </div>

      {/* 一覧 */}
      {visibleChildren.length === 0 ? (
        <Card className="border-dashed border-2 border-diletto-gray/20 bg-transparent rounded-md">
          <CardContent className="py-16 text-center text-diletto-gray-light">
            該当する児童はいません
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {visibleChildren.map((c) => {
            const facility = facilityMap.get(c.facility_id);
            const pickupActive = (c.custom_pickup_areas || []).filter((a) => (c.pickup_area_labels || []).includes(a.id));
            const dropoffActive = (c.custom_dropoff_areas || []).filter((a) => (c.dropoff_area_labels || []).includes(a.id));
            return (
              <Card key={c.id} className="border-diletto-gray/5 shadow-sm rounded-md overflow-hidden bg-white">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <ReorderButtons
                        table="children"
                        itemId={c.id}
                        items={visibleChildren.map((x) => ({ id: x.id, display_order: x.display_order }))}
                        onReordered={loadAll}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-diletto-ink text-base">{c.name}</p>
                          <Badge className="bg-diletto-beige text-diletto-ink border-none text-[10px]">
                            {GRADE_LABELS[c.grade_type]}
                          </Badge>
                          {facility && (
                            <Badge variant="outline" className="text-[10px] border-diletto-gray/20">
                              🏢 {facility.name}
                            </Badge>
                          )}
                          {!c.is_active && (
                            <Badge className="bg-diletto-red/10 text-diletto-red border-none text-[10px]">退所</Badge>
                          )}
                        </div>
                        {(c.home_address || c.parent_contact) && (
                          <p className="text-xs text-diletto-gray-light mt-1">
                            {c.home_address && <>🏠 {c.home_address}</>}
                            {c.home_address && c.parent_contact && <span className="mx-2">·</span>}
                            {c.parent_contact && <>☎ {c.parent_contact}</>}
                          </p>
                        )}
                        {(pickupActive.length > 0 || dropoffActive.length > 0) && (
                          <div className="flex flex-wrap gap-3 mt-2 text-xs">
                            {pickupActive.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] font-bold text-diletto-gray-light">迎:</span>
                                {pickupActive.map((a) => (
                                  <span key={a.id} className="bg-gray-50 border border-diletto-gray/10 rounded px-2 py-0.5">
                                    {a.emoji} {a.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            {dropoffActive.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] font-bold text-diletto-gray-light">送:</span>
                                {dropoffActive.map((a) => (
                                  <span key={a.id} className="bg-gray-50 border border-diletto-gray/10 rounded px-2 py-0.5">
                                    {a.emoji} {a.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => openEdit(c)} className="h-8 rounded-md text-xs font-bold">編集</Button>
                      <Button variant="outline" size="sm" onClick={() => handleDelete(c.id, c.name)} className="h-8 rounded-md text-xs font-bold text-diletto-red">削除</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 編集ダイアログ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? '児童情報の編集' : '児童を追加'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>氏名 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例: 田中 太郎"
                />
              </div>
              <div className="space-y-2">
                <Label>学年 *</Label>
                <select
                  value={form.grade_type}
                  onChange={(e) => setForm({ ...form, grade_type: e.target.value as GradeType })}
                  className="h-10 w-full rounded-md border border-diletto-gray/15 bg-white px-3 text-sm"
                  aria-label="学年"
                >
                  {GRADE_TYPES.filter((g) => g !== 'junior_high').map((g) => (
                    <option key={g} value={g}>{GRADE_LABELS[g]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>所属事業所 *</Label>
                <select
                  value={form.facility_id}
                  onChange={(e) => setForm({ ...form, facility_id: e.target.value })}
                  disabled={scope === 'manager'}
                  className="h-10 w-full rounded-md border border-diletto-gray/15 bg-white px-3 text-sm disabled:bg-gray-50 disabled:text-diletto-gray-light"
                  aria-label="所属事業所"
                >
                  <option value="">-- 選択してください --</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                {scope === 'manager' && (
                  <p className="text-[10px] text-diletto-gray-light">マネージャーは自事業所のみ登録できます</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>在籍状況</Label>
                <label className="flex items-center gap-2 h-10">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="h-4 w-4 accent-diletto-blue"
                  />
                  <span className="text-sm">{form.is_active ? '在籍中' : '退所'}</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>保護者連絡先（任意）</Label>
                <Input
                  value={form.parent_contact}
                  onChange={(e) => setForm({ ...form, parent_contact: e.target.value })}
                  placeholder="090-xxxx-xxxx"
                />
              </div>
              <div className="space-y-2">
                <Label>自宅住所（任意）</Label>
                <Textarea
                  value={form.home_address}
                  onChange={(e) => setForm({ ...form, home_address: e.target.value })}
                  rows={2}
                  placeholder="市区町村〜番地"
                />
              </div>
            </div>

            <AreaEditor
              label="🚐 迎えエリア（この児童のお迎え候補地）"
              areas={form.custom_pickup_areas}
              selectedIds={form.pickup_area_labels}
              onChange={(areas, ids) => setForm({ ...form, custom_pickup_areas: areas, pickup_area_labels: ids })}
            />

            <AreaEditor
              label="🏠 送りエリア（この児童のお送り候補地）"
              areas={form.custom_dropoff_areas}
              selectedIds={form.dropoff_area_labels}
              onChange={(areas, ids) => setForm({ ...form, custom_dropoff_areas: areas, dropoff_area_labels: ids })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>キャンセル</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.facility_id}>
              {saving ? '保存中...' : (editingId ? '更新' : '登録')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
