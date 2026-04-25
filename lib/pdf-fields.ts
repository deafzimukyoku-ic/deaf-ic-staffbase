/**
 * PDF テンプレート用フィールド定義（共通モジュール）
 * PlaceholderMappingEditor.tsx と PdfEditorToolbar.tsx で共有
 */

export interface FieldOption {
  value: string;
  label: string;
}

// --- 社員フィールド ---
export const employeeFields: FieldOption[] = [
  // 結合フィールド
  { value: 'last_name+first_name', label: '氏名' },
  { value: 'last_name_kana+first_name_kana', label: 'フリガナ' },
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
  { value: 'parking_location', label: '駐車場所' },
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

// --- テナントフィールド ---
export const tenantFields: FieldOption[] = [
  { value: 'company_name', label: '会社名' },
  { value: 'representative_title', label: '代表者肩書' },
  { value: 'representative_name', label: '代表者名' },
  { value: 'representative_honorific', label: '代表者敬称' },
  { value: 'bank_name', label: '銀行名' },
];

// --- 固定値フィールド ---
export const fixedFields: FieldOption[] = [
  { value: 'today', label: '本日の日付' },
];

// --- カテゴリラベル ---
export const sourceTypeLabels: Record<string, string> = {
  employee: '社員プロフィール',
  custom_field: 'カスタム項目',
  tenant: '会社情報',
  fixed: '自動設定',
  form_data: '社員入力項目',
};

/**
 * source_type + source_field から日本語表示名を取得
 */
export function getFieldDisplayName(sourceType: string, sourceField: string): string {
  const lists: Record<string, FieldOption[]> = {
    employee: employeeFields,
    tenant: tenantFields,
    fixed: fixedFields,
  };
  const list = lists[sourceType];
  if (list) {
    const found = list.find((f) => f.value === sourceField);
    if (found) return found.label;
  }
  return sourceField;
}

/**
 * column_key ("employee.last_name") から日本語表示名を取得
 */
export function getDisplayNameFromColumnKey(columnKey: string): string {
  const dotIndex = columnKey.indexOf('.');
  if (dotIndex === -1) return columnKey;
  const sourceType = columnKey.substring(0, dotIndex);
  const sourceField = columnKey.substring(dotIndex + 1);
  return getFieldDisplayName(sourceType, sourceField);
}
