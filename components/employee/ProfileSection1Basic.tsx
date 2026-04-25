'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Employee, Facility, CustomEmployeeField } from '@/lib/types';
import { PostalCodeField } from './PostalCodeField';

type BasicFields = Pick<Employee,
  'last_name' | 'first_name' | 'last_name_kana' | 'first_name_kana' |
  'birth_date' | 'gender' | 'postal_code' | 'address' | 'phone' |
  'position' | 'years_of_service' | 'job_type' | 'work_location' |
  'facility_id' |
  'join_date' | 'my_number' | 'previous_employer' | 'qualifications' | 'custom_fields' |
  'bank_name' | 'bank_branch_name' | 'bank_account_type' | 'bank_account_number' | 'bank_account_holder'
>;

interface Props {
  data: BasicFields;
  onChange: (data: BasicFields) => void;
  employeeId?: string;
  showExtended?: boolean;
}

export function ProfileSection1Basic({ data, onChange, employeeId, showExtended = true }: Props) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [positions, setPositions] = useState<{ id: string; name: string }[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomEmployeeField[]>([]);
  const [tenantBanks, setTenantBanks] = useState<string[]>([]);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const supabase = createClient();

  const isYucho = (data.bank_name || '').includes('ゆうちょ');

  useEffect(() => {
    async function loadMasters() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;
      const tid = me.tenant_id;

      const [facs, poss, cfs, banks] = await Promise.all([
        supabase.from('facilities').select('*').eq('tenant_id', tid).order('display_order', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('positions').select('id, name').eq('tenant_id', tid).order('display_order'),
        supabase.from('custom_employee_fields').select('*').eq('tenant_id', tid).eq('is_active', true).order('display_order'),
        supabase.from('tenant_payroll_banks').select('bank_name').eq('tenant_id', tid).order('display_order'),
      ]);
      if (facs.data) setFacilities(facs.data as Facility[]);
      if (poss.data) setPositions(poss.data);
      if (cfs.data) setCustomFieldDefs(cfs.data as CustomEmployeeField[]);
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

  async function handleCustomImageUpload(fieldKey: string, file: File) {
    const maxSizeMb = 10;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('JPG、PNG、WebP、HEIC形式のみ対応しています');
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      toast.error(`ファイルサイズは${maxSizeMb}MB以下にしてください`);
      return;
    }

    setUploadingField(fieldKey);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('認証が必要です'); return; }
      const { data: me } = await supabase.from('employees').select('id, tenant_id').eq('auth_user_id', user.id).single();
      if (!me) { toast.error('社員情報が見つかりません'); return; }

      const targetId = employeeId || me.id;
      const ext = file.name.split('.').pop() || 'jpg';
      const storagePath = `${me.tenant_id}/${targetId}/${fieldKey}_${Date.now()}.${ext}`;

      // Supabase Storageに直接アップロード
      const { error: uploadErr } = await supabase.storage
        .from('employee-images')
        .upload(storagePath, file, { contentType: file.type, upsert: true });
      if (uploadErr) { toast.error(`アップロードに失敗しました: ${uploadErr.message}`); return; }

      // APIでDB更新のみ
      const res = await fetch('/api/employees/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_key: fieldKey, storage_path: storagePath, employee_id: employeeId }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error); return; }
      updateCustom(fieldKey, json.path);
      toast.success('画像をアップロードしました');
    } catch { toast.error('アップロードに失敗しました'); }
    finally { setUploadingField(null); }
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
              <Input type="date" value={data.birth_date} onChange={(e) => update('birth_date', e.target.value)} />
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
              value={data.postal_code}
              onChange={(v) => update('postal_code', v)}
              currentAddress={data.address}
              onAddressFound={(addr) => update('address', addr)}
            />
            <div className="col-span-2 space-y-2">
              <Label>住所 *</Label>
              <Input value={data.address} onChange={(e) => update('address', e.target.value)} />
            </div>
          </div>
          <Field label="電話番号 *" value={data.phone} onChange={(v) => update('phone', v)} placeholder="090-0000-0000" />

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>入社日 *</Label>
                <Input type="date" value={data.join_date} onChange={(e) => update('join_date', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>勤続年数</Label>
                <Input type="number" value={data.years_of_service ?? ''} onChange={(e) => update('years_of_service', e.target.value ? Number(e.target.value) : null)} />
              </div>
            </div>
            <Field label="業務内容" value={data.job_type || ''} onChange={(v) => update('job_type', v || null)} />
            <Field label="個人番号（マイナンバー）" value={data.my_number || ''} onChange={(v) => update('my_number', v || null)} />
            <Field label="最終就職先" value={data.previous_employer || ''} onChange={(v) => update('previous_employer', v || null)} />
            <div className="space-y-2">
              <Label>保有資格</Label>
              <Textarea value={data.qualifications || ''} onChange={(e) => update('qualifications', e.target.value || null)} placeholder="保有資格をご記入ください" rows={2} />
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
              {isYucho ? (
                <Field label="記号" value={data.bank_branch_name || ''} onChange={(v) => update('bank_branch_name', v || null)} placeholder="1XXXX" />
              ) : (
                <Field label="支店名" value={data.bank_branch_name || ''} onChange={(v) => update('bank_branch_name', v || null)} placeholder="○○支店" />
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {!isYucho && (
                <div className="space-y-2">
                  <Label>口座種別</Label>
                  <select className={selectClass} value={data.bank_account_type || ''} onChange={(e) => update('bank_account_type', e.target.value || null)}>
                    <option value="">未選択</option>
                    <option value="ordinary">普通</option>
                    <option value="current">当座</option>
                    <option value="savings">貯蓄</option>
                  </select>
                </div>
              )}
              <Field label={isYucho ? '番号' : '口座番号'} value={data.bank_account_number || ''} onChange={(v) => update('bank_account_number', v || null)} placeholder={isYucho ? 'XXXXXXX' : undefined} />
              <Field label="口座名義" value={data.bank_account_holder || ''} onChange={(v) => update('bank_account_holder', v || null)} placeholder="カナ名義" />
            </div>
          </CardContent>
        </Card>
      </>}

      {/* カスタム項目 */}
      {customFieldDefs.length > 0 && showExtended && (
        <Card>
          <CardHeader><CardTitle>追加項目</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {customFieldDefs.map((cf) => {
              const val = customValues[cf.field_key] || '';
              if (cf.field_type === 'image') {
                const imageUrl = val
                  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/employee-images/${val}`
                  : null;
                return (
                  <div key={cf.field_key} className="space-y-2">
                    <Label>{cf.label}</Label>
                    {imageUrl ? (
                      <div className="space-y-2">
                        <img src={imageUrl} alt={cf.label} className="max-h-48 rounded-md border object-contain" />
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
                            input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleCustomImageUpload(cf.field_key, f); };
                            input.click();
                          }}>変更</Button>
                          <Button type="button" size="sm" variant="ghost" className="text-diletto-red" onClick={() => updateCustom(cf.field_key, null)}>削除</Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={uploadingField === cf.field_key}
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
                          input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleCustomImageUpload(cf.field_key, f); };
                          input.click();
                        }}
                        className="flex items-center justify-center w-full h-24 rounded-md border-2 border-dashed border-diletto-gray/20 hover:border-diletto-blue/40 transition-colors text-sm text-diletto-gray cursor-pointer"
                      >
                        {uploadingField === cf.field_key ? 'アップロード中...' : 'クリックして画像を選択'}
                      </button>
                    )}
                  </div>
                );
              }
              if (cf.field_type === 'select') {
                return (
                  <div key={cf.field_key} className="space-y-2">
                    <Label>{cf.label}</Label>
                    <select className={selectClass} value={val} onChange={(e) => updateCustom(cf.field_key, e.target.value || null)}>
                      <option value="">未選択</option>
                      {cf.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                );
              }
              if (cf.field_type === 'date') {
                return (
                  <div key={cf.field_key} className="space-y-2">
                    <Label>{cf.label}</Label>
                    <Input type="date" value={val} onChange={(e) => updateCustom(cf.field_key, e.target.value || null)} />
                  </div>
                );
              }
              if (cf.field_type === 'number') {
                return (
                  <div key={cf.field_key} className="space-y-2">
                    <Label>{cf.label}</Label>
                    <Input type="number" value={val} onChange={(e) => updateCustom(cf.field_key, e.target.value || null)} />
                  </div>
                );
              }
              return <Field key={cf.field_key} label={cf.label} value={val} onChange={(v) => updateCustom(cf.field_key, v || null)} />;
            })}
          </CardContent>
        </Card>
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

function ImageUpload({ label, path, fieldKey, uploading, onUpload, onClear }: {
  label: string; path: string | null; fieldKey: string; uploading: boolean;
  onUpload: (fieldKey: string, file: File) => void; onClear: () => void;
}) {
  const imageUrl = path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/employee-images/${path}` : null;
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {imageUrl ? (
        <div className="space-y-2">
          <img src={imageUrl} alt={label} className="max-h-48 rounded-md border object-contain" />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => {
              const input = document.createElement('input');
              input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
              input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onUpload(fieldKey, f); };
              input.click();
            }}>変更</Button>
            <Button type="button" size="sm" variant="ghost" className="text-diletto-red" onClick={onClear}>削除</Button>
          </div>
        </div>
      ) : (
        <button
          type="button" disabled={uploading}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
            input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onUpload(fieldKey, f); };
            input.click();
          }}
          className="flex items-center justify-center w-full h-24 rounded-md border-2 border-dashed border-diletto-gray/20 hover:border-diletto-blue/40 transition-colors text-sm text-diletto-gray cursor-pointer"
        >
          {uploading ? 'アップロード中...' : 'クリックして画像を選択'}
        </button>
      )}
    </div>
  );
}
