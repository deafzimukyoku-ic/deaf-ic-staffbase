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
import type { CustomFieldType, Position, CustomFieldSection } from '@/lib/types';
import { CUSTOM_FIELD_SECTION_LABELS } from '@/lib/types';
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

/* gate_fields ↔ プルダウン値の相互変換。プルダウン値はカンマ区切りの文字列。
   現状サポートする条件は has_car_commute / is_shuttle_driver の 2 種のみ（CORE_FIELD_GATES と一致）。
   将来追加する場合は valueToGateFields のホワイトリストも更新すること。 */
function gateFieldsToValue(gateFields: string[]): string {
  if (!gateFields || gateFields.length === 0) return 'all';
  const sorted = [...gateFields].sort().join(',');
  return sorted || 'all';
}
function valueToGateFields(value: string): string[] {
  if (value === 'all' || !value) return [];
  return value.split(',').filter((v) => v === 'has_car_commute' || v === 'is_shuttle_driver');
}

export default function SettingsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [company, setCompany] = useState({ company_name: '', representative_title: '', representative_name: '', representative_honorific: '様' });
  const [values, setValues] = useState({ company_philosophy: '', action_guidelines: '', core_values: '', valued_behaviors: '', avoided_behaviors: '', ideal_culture: '' });
  const [banks, setBanks] = useState<{ bank_name: string; is_default: boolean }[]>([]);
  /* migration 116: facilities に display_order / shift_enabled / transport_enabled を追加。
     migration 121: daily_report_template を追加。
     migration 125: shift_only_mode を追加（true で sidebar をシフト系のみに絞る）。
     UI でドラッグ&ドロップ並び替え + 3 トグルを編集可能に。 */
  const [facilities, setFacilities] = useState<
    { id?: string; name: string; address: string; display_order: number; shift_enabled: boolean; transport_enabled: boolean; shift_only_mode: boolean; daily_report_template: string }[]
  >([]);
  const [positions, setPositions] = useState<(Omit<Position, 'tenant_id' | 'created_at' | 'id'> & { id?: string })[]>([]);
  /* gate_fields: 「この項目を入力するのは誰か」を表す employees の boolean 列名の配列。
     [] = 全員、['has_car_commute'] = マイカー通勤者のみ、等。書類自動判定で使用。 */
  const [customFields, setCustomFields] = useState<{ id?: string; field_key: string; label: string; field_type: CustomFieldType; options: string[]; display_order: number; is_active: boolean; section: CustomFieldSection; gate_fields: string[] }[]>([]);
  const [sectionVisibility, setSectionVisibility] = useState<Record<ProfileSectionKey, boolean>>(
    () => Object.fromEntries(PROFILE_SECTION_KEYS.map((k) => [k, true])) as Record<ProfileSectionKey, boolean>
  );
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
        .select('id, name, address, display_order, shift_enabled, transport_enabled, shift_only_mode, daily_report_template')
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
            shift_only_mode: (f.shift_only_mode as boolean | null) ?? false,
            daily_report_template: (f.daily_report_template as string | null) ?? '',
          })),
        );
      }

      const { data: posData } = await supabase.from('positions').select('id, name, display_order').eq('tenant_id', me.tenant_id).order('display_order');
      if (posData) setPositions(posData);

      const { data: cfData } = await supabase.from('custom_employee_fields').select('id, field_key, label, field_type, options, display_order, is_active, section, gate_fields').eq('tenant_id', me.tenant_id).order('display_order');
      if (cfData) setCustomFields(cfData.map((f: Record<string, unknown>) => ({
        id: f.id as string, field_key: f.field_key as string, label: f.label as string,
        field_type: f.field_type as CustomFieldType, options: (f.options as string[]) || [],
        display_order: f.display_order as number, is_active: f.is_active as boolean,
        section: (f.section as CustomFieldSection) || 'basic',
        gate_fields: (f.gate_fields as string[]) || [],
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
          shift_only_mode: f.shift_only_mode,
          daily_report_template: f.daily_report_template,
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
          shift_only_mode: f.shift_only_mode,
          daily_report_template: f.daily_report_template,
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
          section: f.section, gate_fields: f.gate_fields,
        }).eq('id', f.id!);
      }
    }

    const newCfs = customFields.filter((f) => !f.id && f.label.trim());
    if (newCfs.length > 0) {
      await supabase.from('custom_employee_fields').insert(
        newCfs.map((f) => ({
          tenant_id: tenantId, field_key: f.field_key, label: f.label.trim(),
          field_type: f.field_type, options: f.options, display_order: f.display_order, is_active: f.is_active,
          section: f.section, gate_fields: f.gate_fields,
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
      .select('id, name, address, display_order, shift_enabled, transport_enabled, shift_only_mode, daily_report_template')
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
          shift_only_mode: (f.shift_only_mode as boolean | null) ?? false,
          daily_report_template: (f.daily_report_template as string | null) ?? '',
        })),
      );
    }

    const { data: reloadedPositions } = await supabase.from('positions').select('id, name, display_order').eq('tenant_id', tenantId).order('display_order');
    if (reloadedPositions) setPositions(reloadedPositions);

    const { data: reloadedCfs } = await supabase.from('custom_employee_fields').select('id, field_key, label, field_type, options, display_order, is_active, section, gate_fields').eq('tenant_id', tenantId).order('display_order');
    if (reloadedCfs) setCustomFields(reloadedCfs.map((f: Record<string, unknown>) => ({
      id: f.id as string, field_key: f.field_key as string, label: f.label as string,
      field_type: f.field_type as CustomFieldType, options: (f.options as string[]) || [],
      display_order: f.display_order as number, is_active: f.is_active as boolean,
      section: (f.section as CustomFieldSection) || 'basic',
      gate_fields: (f.gate_fields as string[]) || [],
    })));

  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold whitespace-nowrap">設定</h1>
        <Button onClick={handleSave} disabled={saving} className="whitespace-nowrap shrink-0">{saving ? '保存中...' : '保存'}</Button>
      </div>

      <Tabs defaultValue="dashboard" value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* モバイルでは横スクロール、lg 以上では均等分割 */}
        <TabsList className="mb-6 w-full max-w-full h-12 bg-diletto-beige/40 border border-diletto-gray/10 rounded-xl p-1 overflow-x-auto no-scrollbar justify-start lg:justify-stretch gap-0.5">
          <TabsTrigger value="dashboard" className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-diletto-gray-light hover:text-diletto-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-diletto-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all">🏠 ダッシュボード</TabsTrigger>
          <TabsTrigger value="basic" className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-diletto-gray-light hover:text-diletto-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-diletto-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all">基本情報</TabsTrigger>
          <TabsTrigger value="organization" className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-diletto-gray-light hover:text-diletto-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-diletto-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all">組織設定</TabsTrigger>
          <TabsTrigger value="fields" className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-diletto-gray-light hover:text-diletto-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-diletto-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all">項目設定</TabsTrigger>
          <TabsTrigger value="visibility" className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-diletto-gray-light hover:text-diletto-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-diletto-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all">表示設定</TabsTrigger>
          <TabsTrigger value="values" className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-diletto-gray-light hover:text-diletto-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-diletto-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all">価値観</TabsTrigger>
          <TabsTrigger value="documents" className="flex-none lg:flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-diletto-gray-light hover:text-diletto-ink hover:bg-white/40 data-[state=active]:bg-white data-[state=active]:text-diletto-ink data-[state=active]:shadow-sm data-[state=active]:font-bold transition-all">書類テンプレ</TabsTrigger>
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
              title="書類テンプレ"
              icon="📄"
              description="PDF テンプレート登録・タグ配置・並び替え"
              href="/admin/documents"
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
                    { name: '', address: '', display_order: facilities.length, shift_enabled: true, transport_enabled: true, shift_only_mode: false, daily_report_template: '' },
                  ])
                }
              >
                + 施設を追加
              </Button>
            </CardContent>
          </Card>

          {/* 業務日報の活動内容/連絡事項テンプレート編集（migration 121）。
              施設ごとに自由文（複数行）を保存。業務日報出力時に末尾枠へ印字。 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">業務日報の活動内容／連絡事項</CardTitle>
              <p className="text-xs text-diletto-gray mt-1">
                各施設の業務日報下部に印字するテンプレートを設定できます。改行はそのまま反映されます。
                例:「AM<br/>□朝礼<br/><br/>【連絡事項】<br/>朝礼に記載」
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {facilities.length === 0 ? (
                <p className="text-xs text-diletto-gray-light">先に施設を登録してください。</p>
              ) : (
                facilities.map((f, i) => (
                  <div key={f.id || `dr_new_${i}`} className="space-y-1">
                    <Label className="text-xs font-bold">{f.name || '（施設名未入力）'}</Label>
                    <Textarea
                      rows={4}
                      placeholder="AM&#10;□朝礼&#10;&#10;【連絡事項】&#10;朝礼に記載"
                      value={f.daily_report_template}
                      onChange={(e) => {
                        const next = [...facilities];
                        next[i] = { ...next[i], daily_report_template: e.target.value };
                        setFacilities(next);
                      }}
                    />
                  </div>
                ))
              )}
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
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
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
                      <Label className="text-xs">表示タブ</Label>
                      <select
                        title="表示タブを選択"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                        value={cf.section}
                        onChange={(e) => { const next = [...customFields]; next[i] = { ...next[i], section: e.target.value as CustomFieldSection }; setCustomFields(next); }}
                      >
                        {(Object.entries(CUSTOM_FIELD_SECTION_LABELS) as [CustomFieldSection, string][]).map(([val, lbl]) => (
                          <option key={val} value={val}>{lbl}</option>
                        ))}
                      </select>
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
                  {/* 対象者条件: この項目を入力する社員を絞り込む（プロフィール画面の表示制御のみ）。
                     書類の配布対象は書類テンプレ側で個別設定する（migration 122 document_template_audience）。 */}
                  <div className="space-y-1 pt-2 border-t border-diletto-gray/10">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span>👥 この項目を入力するのは</span>
                      <span className="text-diletto-gray-light text-[10px] font-normal">（プロフィール画面で表示する対象者を絞ります）</span>
                    </Label>
                    <select
                      title="対象者条件"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={gateFieldsToValue(cf.gate_fields)}
                      onChange={(e) => {
                        const next = [...customFields];
                        next[i] = { ...next[i], gate_fields: valueToGateFields(e.target.value) };
                        setCustomFields(next);
                      }}
                    >
                      <option value="all">全員（条件なし）</option>
                      <option value="has_car_commute">マイカー通勤者のみ</option>
                      <option value="is_shuttle_driver">送迎運転者のみ</option>
                      <option value="has_car_commute,is_shuttle_driver">マイカー通勤者または送迎運転者</option>
                    </select>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setCustomFields([...customFields, { field_key: '', label: '', field_type: 'text', options: [], display_order: customFields.length, is_active: true, section: 'basic', gate_fields: [] }])}
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

        {/* 書類テンプレタブ — /admin/documents へのリンクカード（ページ自体は別画面で管理） */}
        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">書類テンプレート</CardTitle>
              <p className="text-xs text-diletto-gray-light mt-1">
                社員に提出させる書類（PDF）のテンプレート登録・タグ配置・並び替えを行います。
              </p>
            </CardHeader>
            <CardContent>
              <a
                href="/admin/documents"
                className="block rounded-md border border-diletto-gray/15 hover:border-diletto-blue/40 hover:bg-diletto-blue/[0.03] p-4 transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-diletto-blue/5 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                    📄
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-diletto-ink text-sm">書類テンプレート管理を開く</h3>
                    <p className="text-xs text-diletto-gray mt-0.5">PDF アップロード／タグ配置／並び替え／一括 PDF 出力</p>
                  </div>
                  <span className="text-diletto-gray-light group-hover:text-diletto-blue group-hover:translate-x-1 transition-all">→</span>
                </div>
              </a>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}

/* href 指定なら別ページ遷移（→アイコン付き）、onClick 指定なら同ページ内タブ切替。
   目的別のナビゲーションが視覚的に区別できるように。 */
function NavCard({
  title,
  icon,
  description,
  onClick,
  href,
}: {
  title: string;
  icon: string;
  description: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <CardContent className="p-5 flex items-center gap-4">
      <div className="h-12 w-12 rounded-2xl bg-diletto-blue/5 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-diletto-ink text-sm flex items-center gap-1.5">
          {title}
          {href && (
            <span className="text-[10px] font-normal text-diletto-blue/70 bg-diletto-blue/10 rounded px-1.5 py-0.5">
              別ページ
            </span>
          )}
        </h3>
        <p className="text-[10px] text-diletto-gray truncate">{description}</p>
      </div>
      {href && (
        <span className="text-diletto-gray-light group-hover:text-diletto-blue group-hover:translate-x-1 transition-all">
          →
        </span>
      )}
    </CardContent>
  );

  const cls = 'cursor-pointer hover:border-diletto-blue/50 hover:shadow-md transition-all group overflow-hidden border-diletto-gray/10 block';

  if (href) {
    return (
      <a href={href} className="contents">
        <Card className={cls}>{inner}</Card>
      </a>
    );
  }
  return (
    <Card onClick={onClick} className={cls}>
      {inner}
    </Card>
  );
}

/* ===== 施設一覧: ドラッグ&ドロップ並び替え + 3 トグル (migration 116 + 125) ===== */
type FacilityRow = {
  id?: string;
  name: string;
  address: string;
  display_order: number;
  shift_enabled: boolean;
  transport_enabled: boolean;
  shift_only_mode: boolean;
  daily_report_template: string;
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
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* 「シフト ON/OFF」(`shift_enabled`) は migration 116 で追加されたが、
            「シフトのみ ON/OFF」と紛らわしいため UI から削除。
            DB カラムは残置（デフォルト true）。本部などをシフトモードから除外したい場合は DB 直接更新で対応。 */}
        <Toggle
          checked={facility.transport_enabled}
          onToggle={() => onChange({ ...facility, transport_enabled: !facility.transport_enabled })}
          label="送迎"
        />
        {/* migration 125: シフトのみモード。ON で利用表/送迎表/日次出力/業務日報/事業所設定/児童管理を sidebar から除外。 */}
        <Toggle
          checked={facility.shift_only_mode}
          onToggle={() => onChange({ ...facility, shift_only_mode: !facility.shift_only_mode })}
          label="シフトのみ"
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
