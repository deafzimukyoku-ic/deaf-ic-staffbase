'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MAX_PAYROLL_BANKS_PER_TENANT, PROFILE_SECTION_KEYS, PROFILE_SECTION_LABELS } from '@/lib/constants';
import type { ProfileSectionKey } from '@/lib/constants';
import { toast } from 'sonner';
import type { CustomFieldType, CategoryType, Position } from '@/lib/types';
import { CategoryManager } from '@/components/admin/CategoryManager';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'テキスト',
  date: '日付',
  number: '数値',
  select: 'プルダウン',
  image: '画像',
};

export default function SettingsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [company, setCompany] = useState({ company_name: '', representative_title: '', representative_name: '', representative_honorific: '様' });
  const [values, setValues] = useState({ company_philosophy: '', action_guidelines: '', core_values: '', valued_behaviors: '', avoided_behaviors: '', ideal_culture: '' });
  const [banks, setBanks] = useState<{ bank_name: string; is_default: boolean }[]>([]);
  /* migration 116: facilities に display_order / shift_enabled / transport_enabled を追加。
     UI でドラッグ&ドロップ並び替え + 2 トグルを編集可能に。 */
  const [facilities, setFacilities] = useState<
    { id?: string; name: string; address: string; display_order: number; shift_enabled: boolean; transport_enabled: boolean }[]
  >([]);
  const [positions, setPositions] = useState<(Omit<Position, 'tenant_id' | 'created_at' | 'id'> & { id?: string })[]>([]);
  const [customFields, setCustomFields] = useState<{ id?: string; field_key: string; label: string; field_type: CustomFieldType; options: string[]; display_order: number; is_active: boolean }[]>([]);
  const [sectionVisibility, setSectionVisibility] = useState<Record<ProfileSectionKey, boolean>>(
    () => Object.fromEntries(PROFILE_SECTION_KEYS.map((k) => [k, true])) as Record<ProfileSectionKey, boolean>
  );
  const [categoryTab, setCategoryTab] = useState<CategoryType>('compliance');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;
      setTenantId(me.tenant_id);

      const { data: tenant } = await supabase.from('tenants').select('*').eq('id', me.tenant_id).single();
      if (tenant) {
        setCompany({ company_name: tenant.company_name, representative_title: tenant.representative_title, representative_name: tenant.representative_name, representative_honorific: tenant.representative_honorific });
        setValues({ company_philosophy: tenant.company_philosophy || '', action_guidelines: tenant.action_guidelines || '', core_values: tenant.core_values || '', valued_behaviors: tenant.valued_behaviors || '', avoided_behaviors: tenant.avoided_behaviors || '', ideal_culture: tenant.ideal_culture || '' });
      }

      const { data: bankData } = await supabase.from('tenant_payroll_banks').select('bank_name, is_default').eq('tenant_id', me.tenant_id).order('display_order');
      if (bankData) setBanks(bankData);

      const { data: facilityData } = await supabase
        .from('facilities')
        .select('id, name, address, display_order, shift_enabled, transport_enabled')
        .eq('tenant_id', me.tenant_id)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (facilityData) {
        setFacilities(
          facilityData.map((f: Record<string, unknown>) => ({
            id: f.id as string | undefined,
            name: (f.name as string) ?? '',
            address: (f.address as string) ?? '',
            display_order: (f.display_order as number | null) ?? 0,
            shift_enabled: (f.shift_enabled as boolean | null) ?? true,
            transport_enabled: (f.transport_enabled as boolean | null) ?? true,
          })),
        );
      }

      const { data: posData } = await supabase.from('positions').select('id, name, display_order').eq('tenant_id', me.tenant_id).order('display_order');
      if (posData) setPositions(posData);

      const { data: cfData } = await supabase.from('custom_employee_fields').select('id, field_key, label, field_type, options, display_order, is_active').eq('tenant_id', me.tenant_id).order('display_order');
      if (cfData) setCustomFields(cfData.map((f: Record<string, unknown>) => ({
        id: f.id as string, field_key: f.field_key as string, label: f.label as string,
        field_type: f.field_type as CustomFieldType, options: (f.options as string[]) || [],
        display_order: f.display_order as number, is_active: f.is_active as boolean,
      })));

      // セクション表示設定
      const { data: visData } = await supabase
        .from('profile_section_visibility')
        .select('section_key, is_visible')
        .eq('tenant_id', me.tenant_id);
      if (visData) {
        const merged = Object.fromEntries(PROFILE_SECTION_KEYS.map((k) => [k, true])) as Record<ProfileSectionKey, boolean>;
        for (const v of visData) {
          if (PROFILE_SECTION_KEYS.includes(v.section_key as ProfileSectionKey)) {
            merged[v.section_key as ProfileSectionKey] = v.is_visible;
          }
        }
        setSectionVisibility(merged);
      }

      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);

    await supabase.from('tenants').update({ ...company, ...values }).eq('id', tenantId);

    await supabase.from('tenant_payroll_banks').delete().eq('tenant_id', tenantId);
    const bankRows = banks.filter((b) => b.bank_name.trim()).map((b, i) => ({ tenant_id: tenantId, bank_name: b.bank_name.trim(), display_order: i, is_default: b.is_default }));
    if (bankRows.length > 0) await supabase.from('tenant_payroll_banks').insert(bankRows);

    // 事業所の保存: 削除→更新→追加の順（削除を先にしないと新規分が消える）
    const existingFacilityIds = facilities.filter((f) => f.id).map((f) => f.id!);
    const { data: allFacilities } = await supabase.from('facilities').select('id').eq('tenant_id', tenantId);
    const facilityToDelete = (allFacilities || []).filter((f) => !existingFacilityIds.includes(f.id));
    for (const f of facilityToDelete) {
      await supabase.from('facilities').delete().eq('id', f.id);
    }

    /* 既存施設: display_order / shift_enabled / transport_enabled も update */
    for (let i = 0; i < facilities.length; i++) {
      const f = facilities[i];
      if (!f.id || !f.name.trim()) continue;
      await supabase
        .from('facilities')
        .update({
          name: f.name.trim(),
          address: f.address.trim(),
          display_order: i,
          shift_enabled: f.shift_enabled,
          transport_enabled: f.transport_enabled,
        })
        .eq('id', f.id);
    }

    const newFacilitiesWithIdx = facilities
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => !f.id && f.name.trim());
    if (newFacilitiesWithIdx.length > 0) {
      await supabase.from('facilities').insert(
        newFacilitiesWithIdx.map(({ f, idx }) => ({
          tenant_id: tenantId,
          name: f.name.trim(),
          address: f.address.trim(),
          display_order: idx,
          shift_enabled: f.shift_enabled,
          transport_enabled: f.transport_enabled,
        })),
      );
    }

    // 役職の保存: 削除→更新→追加の順
    const existingPosIds = positions.filter((p) => p.id).map((p) => p.id!);
    const { data: allPositions } = await supabase.from('positions').select('id').eq('tenant_id', tenantId);
    const posToDelete = (allPositions || []).filter((p) => !existingPosIds.includes(p.id));
    for (const p of posToDelete) {
      await supabase.from('positions').delete().eq('id', p.id);
    }

    for (const p of positions.filter((p) => p.id)) {
      if (p.name.trim()) {
        await supabase.from('positions').update({
          name: p.name.trim(),
          display_order: p.display_order,
        }).eq('id', p.id!);
      }
    }

    const newPositions = positions.filter((p) => !p.id && p.name.trim());
    if (newPositions.length > 0) {
      await supabase.from('positions').insert(
        newPositions.map((p) => ({
          tenant_id: tenantId,
          name: p.name.trim(),
          display_order: p.display_order,
        }))
      );
    }

    // カスタムフィールドの保存: 削除→更新→追加の順
    const existingCfIds = customFields.filter((f) => f.id).map((f) => f.id!);
    const { data: allCfs } = await supabase.from('custom_employee_fields').select('id').eq('tenant_id', tenantId);
    const cfToDelete = (allCfs || []).filter((f) => !existingCfIds.includes(f.id));
    for (const f of cfToDelete) {
      await supabase.from('custom_employee_fields').delete().eq('id', f.id);
    }

    for (const f of customFields.filter((f) => f.id)) {
      if (f.label.trim()) {
        await supabase.from('custom_employee_fields').update({
          label: f.label.trim(), field_key: f.field_key, field_type: f.field_type,
          options: f.options, display_order: f.display_order, is_active: f.is_active,
        }).eq('id', f.id!);
      }
    }

    const newCfs = customFields.filter((f) => !f.id && f.label.trim());
    if (newCfs.length > 0) {
      await supabase.from('custom_employee_fields').insert(
        newCfs.map((f) => ({
          tenant_id: tenantId, field_key: f.field_key, label: f.label.trim(),
          field_type: f.field_type, options: f.options, display_order: f.display_order, is_active: f.is_active,
        }))
      );
    }

    // セクション表示設定の保存
    const visSections = PROFILE_SECTION_KEYS.map((k) => ({
      section_key: k,
      is_visible: sectionVisibility[k],
    }));
    for (const s of visSections) {
      await supabase
        .from('profile_section_visibility')
        .upsert(
          { tenant_id: tenantId, section_key: s.section_key, is_visible: s.is_visible },
          { onConflict: 'tenant_id,section_key' }
        );
    }

    toast.success('設定を保存しました');
    setSaving(false);

    // リロード（新規作成分のIDを取得）
    const { data: reloadedFacilities } = await supabase
      .from('facilities')
      .select('id, name, address, display_order, shift_enabled, transport_enabled')
      .eq('tenant_id', tenantId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (reloadedFacilities) {
      setFacilities(
        reloadedFacilities.map((f: Record<string, unknown>) => ({
          id: f.id as string | undefined,
          name: (f.name as string) ?? '',
          address: (f.address as string) ?? '',
          display_order: (f.display_order as number | null) ?? 0,
          shift_enabled: (f.shift_enabled as boolean | null) ?? true,
          transport_enabled: (f.transport_enabled as boolean | null) ?? true,
        })),
      );
    }

    const { data: reloadedPositions } = await supabase.from('positions').select('id, name, display_order').eq('tenant_id', tenantId).order('display_order');
    if (reloadedPositions) setPositions(reloadedPositions);

    const { data: reloadedCfs } = await supabase.from('custom_employee_fields').select('id, field_key, label, field_type, options, display_order, is_active').eq('tenant_id', tenantId).order('display_order');
    if (reloadedCfs) setCustomFields(reloadedCfs.map((f: Record<string, unknown>) => ({
      id: f.id as string, field_key: f.field_key as string, label: f.label as string,
      field_type: f.field_type as CustomFieldType, options: (f.options as string[]) || [],
      display_order: f.display_order as number, is_active: f.is_active as boolean,
    })));
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">設定</h1>
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
      </div>

      <Tabs defaultValue="dashboard" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 w-full h-11 bg-diletto-beige/30 p-1">
          <TabsTrigger value="dashboard" className="flex-1 font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">🏠 ダッシュボード</TabsTrigger>
          <TabsTrigger value="basic" className="flex-1 font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">基本情報</TabsTrigger>
          <TabsTrigger value="organization" className="flex-1 font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">組織設定</TabsTrigger>
          <TabsTrigger value="fields" className="flex-1 font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">項目設定</TabsTrigger>
          <TabsTrigger value="visibility" className="flex-1 font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">表示設定</TabsTrigger>
          <TabsTrigger value="values" className="flex-1 font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">価値観</TabsTrigger>
          <TabsTrigger value="categories" className="flex-1 font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm">カテゴリ</TabsTrigger>
        </TabsList>

        {/* ダッシュボードタブ */}
        <TabsContent value="dashboard" className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NavCard
              title="基本情報"
              icon="🏢"
              description="会社名、代表者情報、給与振込先銀行の設定"
              onClick={() => setActiveTab('basic')}
            />
            <NavCard
              title="組織（施設・役職）設定"
              icon="🔗"
              description="施設（事業所）と役職ラベルの管理（権限は権限マトリクスで個別設定）"
              onClick={() => setActiveTab('organization')}
            />
            <NavCard
              title="項目設定"
              icon="🛠️"
              description="社員プロフィールに追加するカスタム入力項目"
              onClick={() => setActiveTab('fields')}
            />
            <NavCard
              title="表示設定"
              icon="👁️"
              description="プロフィール画面の各セクションの表示・非表示"
              onClick={() => setActiveTab('visibility')}
            />
            <NavCard
              title="会社価値観"
              icon="✨"
              description="企業理念、行動指針、理想の組織文化など"
              onClick={() => setActiveTab('values')}
            />
            <NavCard
              title="カテゴリ管理"
              icon="📁"
              description="遵守事項、研修、お知らせの分類設定"
              onClick={() => setActiveTab('categories')}
            />
          </div>
        </TabsContent>

        {/* 基本情報タブ */}
        <TabsContent value="basic" className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">会社情報</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2"><Label>会社名</Label><Input value={company.company_name} onChange={(e) => setCompany({ ...company, company_name: e.target.value })} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>代表者肩書</Label><Input value={company.representative_title} onChange={(e) => setCompany({ ...company, representative_title: e.target.value })} /></div>
                <div className="space-y-2"><Label>代表者氏名</Label><Input value={company.representative_name} onChange={(e) => setCompany({ ...company, representative_name: e.target.value })} /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">給与振込先銀行</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {banks.map((b, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <Input className="flex-1" value={b.bank_name} onChange={(e) => { const next = [...banks]; next[i] = { ...next[i], bank_name: e.target.value }; setBanks(next); }} />
                  <Button size="sm" variant={b.is_default ? 'default' : 'outline'} onClick={() => setBanks(banks.map((x, j) => ({ ...x, is_default: j === i })))}>
                    {b.is_default ? 'デフォルト' : '設定'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-diletto-red" onClick={() => setBanks(banks.filter((_, j) => j !== i))}>削除</Button>
                </div>
              ))}
              {banks.length < MAX_PAYROLL_BANKS_PER_TENANT && (
                <Button variant="outline" className="w-full" onClick={() => setBanks([...banks, { bank_name: '', is_default: banks.length === 0 }])}>+ 追加</Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 組織タブ */}
        <TabsContent value="organization" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">施設（事業所）</CardTitle>
              <p className="text-[11px] text-diletto-gray-light mt-1">
                左端 ⋮⋮ をドラッグで並び替え。並び順は全画面のセレクタ・一覧に反映されます。<br />
                「シフト管理」OFF の施設はシフトモードのセレクタ・ナビから非表示。「送迎」OFF は送迎関連のみ非表示。
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <FacilitySortableList
                facilities={facilities}
                onChange={setFacilities}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  setFacilities([
                    ...facilities,
                    { name: '', address: '', display_order: facilities.length, shift_enabled: true, transport_enabled: true },
                  ])
                }
              >
                + 施設を追加
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">役職</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[10px] text-diletto-gray-light mb-2">
                ※ 役職は表示用ラベルです。システム権限は <a className="text-diletto-blue underline" href="/admin/access-matrix">権限マトリクス</a> から個別に設定してください。
                左端 ⋮⋮ をドラッグで並び替え。
              </p>
              <PositionSortableList positions={positions} onChange={setPositions} />
              <Button variant="outline" className="w-full text-xs" onClick={() => setPositions([...positions, { name: '', display_order: positions.length }])}>+ 役職を追加</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 項目設定タブ */}
        <TabsContent value="fields" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">カスタム入力項目</CardTitle>
              <p className="text-xs text-diletto-gray mt-1">社員の基本情報ページに追加する入力項目を管理できます</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {customFields.map((cf, i) => (
                <div key={cf.id || `new-cf-${i}`} className="rounded-md border border-diletto-gray/15 p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">項目名</Label>
                      <Input
                        placeholder="例: 血液型"
                        value={cf.label}
                        onChange={(e) => {
                          const next = [...customFields];
                          const label = e.target.value;
                          const autoKey = next[i].id ? next[i].field_key : `cf_${label.replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFa-zA-Z0-9]/g, '').slice(0, 10)}_${Date.now().toString(36).slice(-4)}`;
                          next[i] = { ...next[i], label, field_key: next[i].field_key || autoKey };
                          setCustomFields(next);
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">入力タイプ</Label>
                      <select
                        title="入力タイプを選択"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                        value={cf.field_type}
                        onChange={(e) => { const next = [...customFields]; next[i] = { ...next[i], field_type: e.target.value as CustomFieldType }; setCustomFields(next); }}
                      >
                        {(Object.entries(FIELD_TYPE_LABELS) as [CustomFieldType, string][]).map(([val, lbl]) => (
                          <option key={val} value={val}>{lbl}</option>
                        ))}
                      </select>
                    </div>
                    <Button size="sm" variant="ghost" className="text-diletto-red h-9" onClick={() => setCustomFields(customFields.filter((_, j) => j !== i))}>削除</Button>
                  </div>
                  {cf.field_type === 'select' && (
                    <div className="space-y-1">
                      <Label className="text-xs">選択肢（カンマ区切り）</Label>
                      <Input
                        placeholder="A型, B型, O型, AB型"
                        value={cf.options.join(', ')}
                        onChange={(e) => {
                          const next = [...customFields];
                          next[i] = { ...next[i], options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) };
                          setCustomFields(next);
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setCustomFields([...customFields, { field_key: '', label: '', field_type: 'text', options: [], display_order: customFields.length, is_active: true }])}
              >
                + カスタム項目を追加
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 表示設定タブ */}
        <TabsContent value="visibility" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">プロフィールセクション表示設定</CardTitle>
              <p className="text-xs text-diletto-gray mt-1">社員プロフィール画面で表示するセクションを選択できます</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {PROFILE_SECTION_KEYS.map((key) => (
                <label key={key} className="flex items-center justify-between rounded-md border border-diletto-gray/15 p-3 cursor-pointer hover:bg-diletto-beige transition-colors">
                  <span className="text-sm font-medium">{PROFILE_SECTION_LABELS[key]}</span>
                  <input
                    type="checkbox"
                    checked={sectionVisibility[key]}
                    onChange={(e) => setSectionVisibility({ ...sectionVisibility, [key]: e.target.checked })}
                    className="h-4 w-4 rounded accent-diletto-blue"
                  />
                </label>
              ))}
              <p className="text-xs text-diletto-gray mt-2">※ 氏名・フリガナ・生年月日などの必須項目は常に表示されます</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 価値観タブ */}
        <TabsContent value="values" className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">会社価値観</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(['company_philosophy', 'action_guidelines', 'core_values', 'valued_behaviors', 'avoided_behaviors', 'ideal_culture'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs">{key === 'company_philosophy' ? '企業理念' : key === 'action_guidelines' ? '行動指針' : key === 'core_values' ? '重視する価値観' : key === 'valued_behaviors' ? '評価したい行動' : key === 'avoided_behaviors' ? '避けたい行動' : '理想の組織文化'}</Label>
                  <Textarea rows={2} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* カテゴリタブ */}
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">カテゴリ管理</CardTitle>
              <p className="text-xs text-diletto-gray-light mt-1">
                遵守事項・研修・お知らせ・業務マニュアルに分類を設定します。名前・色・アイコン（絵文字）を自由に設定できます。
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 p-1 bg-diletto-beige/30 rounded-lg border border-diletto-gray/5">
                {([
                  { key: 'compliance' as CategoryType, label: '遵守事項', icon: '✅', color: 'bg-red-50 text-red-700 border-red-200' },
                  { key: 'training' as CategoryType, label: '研修', icon: '📚', color: 'bg-green-50 text-green-700 border-green-200' },
                  { key: 'announcement' as CategoryType, label: 'お知らせ', icon: '📢', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                  { key: 'manual' as CategoryType, label: '業務マニュアル', icon: '📖', color: 'bg-amber-50 text-amber-700 border-amber-200' },
                ]).map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCategoryTab(tab.key)}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md border transition-all ${categoryTab === tab.key
                      ? `${tab.color} border-current shadow-sm scale-105`
                      : 'bg-white border-diletto-gray/10 text-diletto-gray-light hover:border-diletto-gray/30 hover:text-diletto-ink'
                      }`}
                  >
                    <span className="text-lg">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
              <CategoryManager key={categoryTab} type={categoryTab} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NavCard({ title, icon, description, onClick }: { title: string; icon: string; description: string; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="cursor-pointer hover:border-diletto-blue/50 hover:shadow-md transition-all group overflow-hidden border-diletto-gray/10">
      <CardContent className="p-5 flex items-center gap-4">
        <div className="h-12 w-12 rounded-2xl bg-diletto-blue/5 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-diletto-ink text-sm">{title}</h3>
          <p className="text-[10px] text-diletto-gray truncate">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===== 施設一覧: ドラッグ&ドロップ並び替え + 2 トグル (migration 116) ===== */
type FacilityRow = {
  id?: string;
  name: string;
  address: string;
  display_order: number;
  shift_enabled: boolean;
  transport_enabled: boolean;
};

function FacilitySortableList({
  facilities,
  onChange,
}: {
  facilities: FacilityRow[];
  onChange: (next: FacilityRow[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* 並び替え時の id は existing は f.id、未保存の新規行は idx ベースの一時 id を使う */
  const itemIds = facilities.map((f, i) => f.id ?? `__new_${i}`);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = itemIds.indexOf(String(active.id));
    const to = itemIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(facilities, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {facilities.map((f, i) => (
          <FacilityRowItem
            key={itemIds[i]}
            sortableId={itemIds[i]}
            facility={f}
            onChange={(next) => {
              const nextArr = [...facilities];
              nextArr[i] = next;
              onChange(nextArr);
            }}
            onDelete={() => onChange(facilities.filter((_, j) => j !== i))}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function FacilityRowItem({
  sortableId,
  facility,
  onChange,
  onDelete,
}: {
  sortableId: string;
  facility: FacilityRow;
  onChange: (next: FacilityRow) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const Toggle = ({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) => (
    <button
      type="button"
      onClick={onToggle}
      title={`${label}: ${checked ? 'ON' : 'OFF'}`}
      className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors whitespace-nowrap ${
        checked
          ? 'bg-diletto-blue text-white border-diletto-blue'
          : 'bg-white text-diletto-gray-light border-diletto-gray/20'
      }`}
    >
      {label} {checked ? 'ON' : 'OFF'}
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 items-center bg-white">
      <button
        type="button"
        className="cursor-grab text-diletto-gray-light hover:text-diletto-ink px-1 select-none"
        title="ドラッグで並び替え"
        {...attributes}
        {...listeners}
        aria-label="並び替えハンドル"
      >
        ⋮⋮
      </button>
      <div className="flex-1 space-y-1">
        <Input
          placeholder="事業所名（先頭に絵文字も可: 🌸 パステル）"
          value={facility.name}
          onChange={(e) => onChange({ ...facility, name: e.target.value })}
        />
      </div>
      <div className="flex-1 space-y-1">
        <Input
          placeholder="住所"
          value={facility.address}
          onChange={(e) => onChange({ ...facility, address: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Toggle
          checked={facility.shift_enabled}
          onToggle={() => onChange({ ...facility, shift_enabled: !facility.shift_enabled })}
          label="シフト"
        />
        <Toggle
          checked={facility.transport_enabled}
          onToggle={() => onChange({ ...facility, transport_enabled: !facility.transport_enabled })}
          label="送迎"
        />
      </div>
      <Button size="sm" variant="ghost" className="text-diletto-red" onClick={onDelete}>
        削除
      </Button>
    </div>
  );
}

/* ===== 役職一覧: ドラッグ&ドロップ並び替え（display_order 昇順保存） ===== */
type PositionRow = { id?: string; name: string; display_order: number };

function PositionSortableList({
  positions,
  onChange,
}: {
  positions: PositionRow[];
  onChange: (next: PositionRow[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const itemIds = positions.map((p, i) => p.id ?? `__new_pos_${i}`);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = itemIds.indexOf(String(active.id));
    const to = itemIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const moved = arrayMove(positions, from, to);
    /* display_order を array index に再採番 */
    onChange(moved.map((p, idx) => ({ ...p, display_order: idx })));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {positions.map((p, i) => (
          <PositionRowItem
            key={itemIds[i]}
            sortableId={itemIds[i]}
            position={p}
            onChange={(next) => {
              const arr = [...positions];
              arr[i] = next;
              onChange(arr);
            }}
            onDelete={() => onChange(positions.filter((_, j) => j !== i))}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function PositionRowItem({
  sortableId,
  position,
  onChange,
  onDelete,
}: {
  sortableId: string;
  position: PositionRow;
  onChange: (next: PositionRow) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 items-center bg-white">
      <button
        type="button"
        className="cursor-grab text-diletto-gray-light hover:text-diletto-ink px-1 select-none"
        title="ドラッグで並び替え"
        {...attributes}
        {...listeners}
        aria-label="並び替えハンドル"
      >
        ⋮⋮
      </button>
      <Input
        className="flex-1"
        placeholder="役職名"
        value={position.name}
        onChange={(e) => onChange({ ...position, name: e.target.value })}
      />
      <Button size="sm" variant="ghost" className="text-diletto-red p-2" onClick={onDelete}>
        <span className="text-xs">削除</span>
      </Button>
    </div>
  );
}
