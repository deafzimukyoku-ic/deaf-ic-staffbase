'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MAPPING_SOURCE_TYPES, INPUT_TYPES } from '@/lib/constants';
import type { MappingSourceType, InputType } from '@/lib/constants';

interface Props {
  mapping: PlaceholderMapping[];
  onChange: (mapping: PlaceholderMapping[]) => void;
}

// 社員カラムの選択肢
const employeeFields: { value: string; label: string }[] = [
  // 基本情報
  { value: 'last_name', label: '姓' },
  { value: 'first_name', label: '名' },
  { value: 'last_name_kana', label: '姓（カナ）' },
  { value: 'first_name_kana', label: '名（カナ）' },
  { value: 'birth_date', label: '生年月日' },
  { value: 'gender', label: '性別' },
  { value: 'postal_code', label: '郵便番号' },
  { value: 'address', label: '住所' },
  { value: 'phone', label: '電話番号' },
  { value: 'position', label: '役職' },
  { value: 'join_date', label: '入社日' },
  { value: 'employee_number', label: '従業員NO' },
  { value: 'email', label: 'メールアドレス' },
  { value: 'work_location', label: '勤務地' },
  { value: 'job_type', label: '業務内容' },
  { value: 'my_number', label: '個人番号（マイナンバー）' },
  { value: 'previous_employer', label: '最終就職先' },
  { value: 'qualifications', label: '資格' },
  // マイカー通勤
  { value: 'car_model', label: '車種' },
  { value: 'car_plate_number', label: '車両ナンバー' },
  { value: 'license_type', label: '免許種別' },
  { value: 'license_number', label: '免許証番号' },
  { value: 'license_expiry', label: '免許有効期限' },
  { value: 'insurance_company', label: '保険会社' },
  { value: 'insurance_policy_number', label: '保険証券番号' },
  { value: 'insurance_expiry', label: '保険有効期限' },
  { value: 'vehicle_inspection_expiry', label: '車検有効期限' },
  { value: 'commute_distance', label: '通勤距離' },
  // 運転関連
  { value: 'driving_experience', label: '運転経歴' },
  { value: 'accident_history', label: '事故・違反歴' },
  { value: 'training_attendance', label: '講習受講歴' },
  // 緊急連絡先1
  { value: 'emergency1_name', label: '緊急連絡先1 氏名' },
  { value: 'emergency1_relationship', label: '緊急連絡先1 続柄' },
  { value: 'emergency1_phone', label: '緊急連絡先1 電話' },
  { value: 'emergency1_mobile', label: '緊急連絡先1 携帯' },
  { value: 'emergency1_postal_code', label: '緊急連絡先1 郵便番号' },
  { value: 'emergency1_address', label: '緊急連絡先1 住所' },
  // 緊急連絡先2
  { value: 'emergency2_name', label: '緊急連絡先2 氏名' },
  { value: 'emergency2_relationship', label: '緊急連絡先2 続柄' },
  { value: 'emergency2_phone', label: '緊急連絡先2 電話' },
  { value: 'emergency2_mobile', label: '緊急連絡先2 携帯' },
  { value: 'emergency2_postal_code', label: '緊急連絡先2 郵便番号' },
  { value: 'emergency2_address', label: '緊急連絡先2 住所' },
  // 身元保証人
  { value: 'guarantor_name', label: '保証人 氏名' },
  { value: 'guarantor_birth_date', label: '保証人 生年月日' },
  { value: 'guarantor_postal_code', label: '保証人 郵便番号' },
  { value: 'guarantor_address', label: '保証人 住所' },
  { value: 'guarantor_phone', label: '保証人 電話番号' },
  { value: 'guarantor_relationship', label: '本人との関係' },
];

const tenantFields: { value: string; label: string }[] = [
  { value: 'company_name', label: '会社名' },
  { value: 'representative_title', label: '代表者肩書' },
  { value: 'representative_name', label: '代表者名' },
  { value: 'representative_honorific', label: '代表者敬称' },
  { value: 'bank_name', label: '銀行名' },
];

const fixedFields: { value: string; label: string }[] = [
  { value: 'today', label: '本日の日付' },
];

export interface PlaceholderMapping {
  key: string;
  source_type: MappingSourceType;
  source_field: string;
  label: string | null;
  input_type: InputType | null;
  options: string[] | null;
  required: boolean | null;
}

const sourceLabels: Record<MappingSourceType, string> = {
  employee: '社員プロフィールから自動取得',
  tenant: '会社情報から自動取得（社員は操作不可）',
  form_data: '社員が書類ごとに入力',
  fixed: 'システム自動設定（日付など）',
};

export function PlaceholderMappingEditor({ mapping, onChange }: Props) {
  function updateItem(index: number, updates: Partial<PlaceholderMapping>) {
    const next = [...mapping];
    next[index] = { ...next[index], ...updates };

    // source_type 変更時にリセット
    if (updates.source_type) {
      if (updates.source_type !== 'form_data') {
        next[index].label = null;
        next[index].input_type = null;
        next[index].options = null;
        next[index].required = null;
      } else {
        next[index].label = next[index].label || next[index].key;
        next[index].input_type = 'text';
        next[index].required = false;
      }
      next[index].source_field = '';
    }

    onChange(next);
  }

  return (
    <div className="space-y-4">
      {mapping.map((m, i) => (
        <Card key={`${m.key}-${i}`}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Badge variant="outline">{m.key}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* マッピング先種別 */}
            <div className="space-y-1">
              <Label className="text-xs text-diletto-gray-light">マッピング先</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={m.source_type}
                onChange={(e) => updateItem(i, { source_type: e.target.value as MappingSourceType })}
              >
                {MAPPING_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{sourceLabels[t]}</option>
                ))}
              </select>
            </div>

            {/* source_field */}
            {m.source_type === 'employee' && (
              <div className="space-y-1">
                <Label className="text-xs text-diletto-gray-light">社員プロフィール項目</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={m.source_field}
                  onChange={(e) => updateItem(i, { source_field: e.target.value })}
                >
                  <option value="">選択...</option>
                  {employeeFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            )}

            {m.source_type === 'tenant' && (
              <div className="space-y-1">
                <Label className="text-xs text-diletto-gray-light">会社情報項目</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={m.source_field}
                  onChange={(e) => updateItem(i, { source_field: e.target.value })}
                >
                  <option value="">選択...</option>
                  {tenantFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            )}

            {m.source_type === 'fixed' && (
              <div className="space-y-1">
                <Label className="text-xs text-diletto-gray-light">自動設定項目</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={m.source_field}
                  onChange={(e) => updateItem(i, { source_field: e.target.value })}
                >
                  <option value="">選択...</option>
                  {fixedFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            )}

            {/* form_data 追加設定 */}
            {m.source_type === 'form_data' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-diletto-gray-light">フィールド名（内部キー）</Label>
                  <Input
                    value={m.source_field}
                    onChange={(e) => updateItem(i, { source_field: e.target.value })}
                    placeholder={m.key}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-diletto-gray-light">ラベル（社員画面表示）</Label>
                    <Input
                      value={m.label || ''}
                      onChange={(e) => updateItem(i, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-diletto-gray-light">入力タイプ</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                      value={m.input_type || 'text'}
                      onChange={(e) => updateItem(i, { input_type: e.target.value as InputType })}
                    >
                      {INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {m.input_type === 'select' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-diletto-gray-light">選択肢（カンマ区切り）</Label>
                    <Input
                      value={(m.options || []).join(', ')}
                      onChange={(e) => updateItem(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      placeholder="選択肢1, 選択肢2, 選択肢3"
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={m.required || false}
                    onChange={(e) => updateItem(i, { required: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm">必須項目</span>
                </label>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
