'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import type { Employee, Facility, CustomEmployeeField } from '@/lib/types';
import { PostalCodeField } from './PostalCodeField';
import { CustomFieldsCard } from './CustomFieldsCard';
import QualificationsInput from './QualificationsInput';

type BasicFields = Pick<Employee,
  'last_name' | 'first_name' | 'last_name_kana' | 'first_name_kana' |
  'birth_date' | 'gender' | 'postal_code' | 'address' | 'phone' |
  'position' | 'years_of_service' | 'job_type' | 'work_location' |
  'facility_id' |
  'default_start_time' | 'default_end_time' |
  'join_date' | 'my_number' | 'previous_employer' | 'qualifications' | 'custom_fields' |
  'bank_name' | 'bank_branch_name' | 'bank_account_type' | 'bank_account_number' | 'bank_account_holder'
>;

interface Props {
  data: BasicFields;
  onChange: (data: BasicFields) => void;
  employeeId?: string;
  showExtended?: boolean;
  /* 親 (profile/page.tsx) で section='basic' でフィルタしたカスタム項目定義を受け取る。 */
  customFieldDefs?: CustomEmployeeField[];
}

export function ProfileSection1Basic({ data, onChange, employeeId, showExtended = true, customFieldDefs = [] }: Props) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [positions, setPositions] = useState<{ id: string; name: string }[]>([]);
  const [tenantBanks, setTenantBanks] = useState<string[]>([]);
  /* migration 129 で「保有資格」は自由入力に分離。事業所マスタ (facility_shift_settings.qualification_types) は
     シフト・送迎側 (employees.shift_qualifications) でのみ使用するため、ここでは取得不要。 */
  const supabase = createClient();

  useEffect(() => {
    async function loadMasters() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;
      const tid = me.tenant_id;

      const [facs, poss, banks] = await Promise.all([
        supabase.from('facilities').select('*').eq('tenant_id', tid).order('display_order', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('positions').select('id, name').eq('tenant_id', tid).order('display_order'),
        supabase.from('tenant_payroll_banks').select('bank_name').eq('tenant_id', tid).order('display_order'),
      ]);
      if (facs.data) setFacilities(facs.data as Facility[]);
      if (poss.data) setPositions(poss.data);
      if (banks.data) setTenantBanks(banks.data.map((b: { bank_name: string }) => b.bank_name));
    }
    loadMasters();
  }, [supabase]);

  function update<K extends keyof BasicFields>(key: K, value: BasicFields[K]) {
    onChange({ ...data, [key]: value });
  }

  const customValues = (data.custom_fields as Record<string, string>) || {};
  function updateCustom(key: string, value: string | null) {
    const next = { ...customValues, [key]: value || '' };
    update('custom_fields', next as BasicFields['custom_fields']);
  }

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>基本情報</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="姓 *" value={data.last_name} onChange={(v) => update('last_name', v)} />
            <Field label="名 *" value={data.first_name} onChange={(v) => update('first_name', v)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="姓（カナ） *" value={data.last_name_kana} onChange={(v) => update('last_name_kana', v)} />
            <Field label="名（カナ） *" value={data.first_name_kana} onChange={(v) => update('first_name_kana', v)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>生年月日 *</Label>
              <Input type="date" value={data.birth_date ?? ''} onChange={(e) => update('birth_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>性別</Label>
              <select className={selectClass} value={data.gender || ''} onChange={(e) => update('gender', e.target.value || null)}>
                <option value="">未選択</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PostalCodeField
              label="郵便番号"
              required
              value={data.postal_code ?? ''}
              onChange={(v) => update('postal_code', v)}
              currentAddress={data.address ?? ''}
              onAddressFound={(addr) => update('address', addr)}
            />
            <div className="col-span-2 space-y-2">
              <Label>住所 *</Label>
              <Input value={data.address ?? ''} onChange={(e) => update('address', e.target.value)} />
            </div>
          </div>
          <Field label="電話番号 *" value={data.phone ?? ''} onChange={(v) => update('phone', v)} placeholder="090-0000-0000" />

          {showExtended && <>
            {/* 施設 → グループ → 役職 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>施設</Label>
                <select className={selectClass} value={data.facility_id || ''} onChange={(e) => update('facility_id', e.target.value || null)}>
                  <option value="">未選択</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>役職</Label>
                <select className={selectClass} value={data.position || ''} onChange={(e) => update('position', e.target.value || null)}>
                  <option value="">未選択</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 基本勤務時間: シフト・送迎モードで初期表示する勤務時間と同じカラム (default_start_time / default_end_time)。
                ここで編集すれば職員管理画面 (/admin/shifts/staff-settings) にも反映される。 */}
            <div className="space-y-2">
              <Label>基本勤務時間</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  aria-label="基本勤務開始時刻"
                  value={(data.default_start_time ?? '').slice(0, 5)}
                  onChange={(e) => update('default_start_time', e.target.value || null)}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground shrink-0">〜</span>
                <Input
                  type="time"
                  aria-label="基本勤務終了時刻"
                  value={(data.default_end_time ?? '').slice(0, 5)}
                  onChange={(e) => update('default_end_time', e.target.value || null)}
                  className="flex-1"
                />
              </div>
              <p className="text-[11px] text-brand-gray-light px-1">
                シフト・送迎表モードの初期勤務時間として使われます。
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>入社日 *</Label>
                <Input type="date" value={data.join_date ?? ''} onChange={(e) => update('join_date', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>勤続年数</Label>
                <Input type="number" value={data.years_of_service ?? ''} onChange={(e) => update('years_of_service', e.target.value ? Number(e.target.value) : null)} />
              </div>
            </div>
            <Field label="業務内容" value={data.job_type || ''} onChange={(v) => update('job_type', v || null)} />
            <Field label="個人番号（マイナンバー）" value={data.my_number || ''} onChange={(v) => update('my_number', v || null)} />
            <Field label="最終就職先" value={data.previous_employer || ''} onChange={(v) => update('previous_employer', v || null)} />
            {/* 保有資格: 個人が持っている資格の自由入力（介護福祉士、英検 等）。
                migration 129 で運用分離 — シフト・送迎用の有資格者判定は employees.shift_qualifications を使用。
                ここで入力された値は employees.qualifications text[] にそのまま保存される（事業所マスタ非依存）。 */}
            <div className="space-y-2">
              <Label>保有資格</Label>
              <p className="text-[11px] text-brand-gray-light px-1">
                個人で取得した資格を自由に追加できます（プロフィール表示用）。シフト・送迎の有資格者判定は事業所側で別途管理されます。
              </p>
              <QualificationsInput
                value={data.qualifications ?? []}
                onChange={(next) => update('qualifications', next)}
              />
            </div>
          </>}
        </CardContent>
      </Card>

      {showExtended && <>
        {/* 振込先口座 */}
        <Card>
          <CardHeader><CardTitle>振込先口座</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>銀行名</Label>
                <select className={selectClass} value={data.bank_name || ''} onChange={(e) => update('bank_name', e.target.value || null)}>
                  <option value="">未選択</option>
                  {tenantBanks.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <Field label="支店名" value={data.bank_branch_name || ''} onChange={(v) => update('bank_branch_name', v || null)} placeholder="○○支店" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>口座種別</Label>
                <select className={selectClass} value={data.bank_account_type || ''} onChange={(e) => update('bank_account_type', e.target.value || null)}>
                  <option value="">未選択</option>
                  <option value="ordinary">普通</option>
                  <option value="current">当座</option>
                  <option value="savings">貯蓄</option>
                </select>
              </div>
              <Field label="口座番号" value={data.bank_account_number || ''} onChange={(v) => update('bank_account_number', v || null)} />
              <Field label="口座名義" value={data.bank_account_holder || ''} onChange={(v) => update('bank_account_holder', v || null)} placeholder="カナ名義" />
            </div>
          </CardContent>
        </Card>
      </>}

      {/* カスタム項目（section='basic' のもののみ。見出しは「その他の基本情報」） */}
      {showExtended && (
        <CustomFieldsCard
          section="basic"
          defs={customFieldDefs}
          values={customValues}
          onChange={(next) => update('custom_fields', next as BasicFields['custom_fields'])}
          employeeId={employeeId}
        />
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

