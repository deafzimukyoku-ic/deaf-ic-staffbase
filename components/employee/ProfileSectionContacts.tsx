'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PostalCodeField } from './PostalCodeField';
import type { Employee, CustomEmployeeField } from '@/lib/types';
import { CustomFieldsCard } from './CustomFieldsCard';

type ContactFields = Pick<Employee,
  'emergency1_name' | 'emergency1_relationship' | 'emergency1_phone' |
  'emergency1_mobile' | 'emergency1_postal_code' | 'emergency1_address' |
  'emergency2_name' | 'emergency2_relationship' | 'emergency2_phone' |
  'emergency2_mobile' | 'emergency2_postal_code' | 'emergency2_address' |
  'guarantor_name' | 'guarantor_birth_date' | 'guarantor_postal_code' |
  'guarantor_address' | 'guarantor_phone' | 'guarantor_relationship' | 'custom_fields'
>;

interface Props {
  data: ContactFields;
  onChange: (data: ContactFields) => void;
  employeeId?: string;
  customFieldDefs?: CustomEmployeeField[];
}

export function ProfileSectionContacts({ data, onChange, employeeId, customFieldDefs = [] }: Props) {
  function update<K extends keyof ContactFields>(key: K, value: ContactFields[K]) {
    onChange({ ...data, [key]: value });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>緊急連絡先</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm font-medium text-diletto-ink">連絡先 1</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="氏名 *" value={data.emergency1_name || ''} onChange={(v) => update('emergency1_name', v || null)} />
            <Field label="続柄 *" value={data.emergency1_relationship || ''} onChange={(v) => update('emergency1_relationship', v || null)} placeholder="父、母、配偶者 等" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="電話番号 *" value={data.emergency1_phone || ''} onChange={(v) => update('emergency1_phone', v || null)} />
            <Field label="携帯番号" value={data.emergency1_mobile || ''} onChange={(v) => update('emergency1_mobile', v || null)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PostalCodeField
              value={data.emergency1_postal_code || ''}
              onChange={(v) => update('emergency1_postal_code', v || null)}
              currentAddress={data.emergency1_address || ''}
              onAddressFound={(addr) => update('emergency1_address', addr)}
            />
            <div className="col-span-2 space-y-2">
              <Label>住所</Label>
              <Input value={data.emergency1_address || ''} onChange={(e) => update('emergency1_address', e.target.value || null)} />
            </div>
          </div>

          <div className="border-t border-diletto-gray/10 pt-4">
            <p className="text-sm font-medium text-diletto-ink mb-4">連絡先 2（任意）</p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="氏名" value={data.emergency2_name || ''} onChange={(v) => update('emergency2_name', v || null)} />
                <Field label="続柄" value={data.emergency2_relationship || ''} onChange={(v) => update('emergency2_relationship', v || null)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="電話番号" value={data.emergency2_phone || ''} onChange={(v) => update('emergency2_phone', v || null)} />
                <Field label="携帯番号" value={data.emergency2_mobile || ''} onChange={(v) => update('emergency2_mobile', v || null)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <PostalCodeField
                  value={data.emergency2_postal_code || ''}
                  onChange={(v) => update('emergency2_postal_code', v || null)}
                  currentAddress={data.emergency2_address || ''}
                  onAddressFound={(addr) => update('emergency2_address', addr)}
                />
                <div className="col-span-2 space-y-2">
                  <Label>住所</Label>
                  <Input value={data.emergency2_address || ''} onChange={(e) => update('emergency2_address', e.target.value || null)} />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>身元保証人</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="保証人 氏名 *" value={data.guarantor_name || ''} onChange={(v) => update('guarantor_name', v || null)} />
            <Field label="本人との関係 *" value={data.guarantor_relationship || ''} onChange={(v) => update('guarantor_relationship', v || null)} placeholder="父、母、叔父 等" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>保証人 生年月日</Label>
              <Input type="date" value={data.guarantor_birth_date || ''} onChange={(e) => update('guarantor_birth_date', e.target.value || null)} />
            </div>
            <Field label="保証人 電話番号 *" value={data.guarantor_phone || ''} onChange={(v) => update('guarantor_phone', v || null)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PostalCodeField
              label="保証人 郵便番号"
              value={data.guarantor_postal_code || ''}
              onChange={(v) => update('guarantor_postal_code', v || null)}
              currentAddress={data.guarantor_address || ''}
              onAddressFound={(addr) => update('guarantor_address', addr)}
            />
            <div className="col-span-2 space-y-2">
              <Label>保証人 住所 *</Label>
              <Input value={data.guarantor_address || ''} onChange={(e) => update('guarantor_address', e.target.value || null)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* カスタム項目（section='contacts' のもののみ。見出しは「その他の連絡先情報」） */}
      <CustomFieldsCard
        section="contacts"
        defs={customFieldDefs}
        values={(data.custom_fields as Record<string, string>) || {}}
        onChange={(next) => update('custom_fields', next as ContactFields['custom_fields'])}
        employeeId={employeeId}
      />
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
