/**
 * フィールドの該当判定（Field Applicability）
 *
 * 「この社員にこのフィールドが該当するか」を一元管理。
 * 書類タグの source_field に基づいて、書類が当該社員に必要か自動判定する。
 *
 * 設計方針:
 * - コアフィールド（employees テーブルの固定列）はここに hard-code でゲートを定義
 * - カスタムフィールドは custom_employee_fields.gate_fields で動的に設定可（migration 119）
 * - ゲートは複数指定可（OR セマンティクス）。例: 免許関係は「has_car_commute OR is_shuttle_driver」
 * - ゲート指定無し（または employee に該当ゲートが無い）→ 全員該当扱い
 *
 * 利用箇所:
 * - lib/document-applicability.ts の isDocumentApplicable
 * - 進捗計算、書類一覧フィルタ、社員詳細の書類タブ
 */

import type { Employee } from '@/lib/types';

/** Employee の boolean フラグのみ抽出した型 */
type EmployeeBooleanField = {
  [K in keyof Employee]: Employee[K] extends boolean | null | undefined
    ? Employee[K] extends string | number | object
      ? never
      : K
    : never;
}[keyof Employee];

/**
 * コアフィールド（employees テーブルの固定列）のゲート定義。
 * - キー: employees の列名
 * - 値: その列が該当するために true である必要のあるフラグの配列（OR）
 * - 配列空 or キー未定義 = 全員該当
 *
 * 例:
 *   car_model → ['has_car_commute']      ＝ has_car_commute=true の社員のみ該当
 *   license_number → ['has_car_commute', 'is_shuttle_driver']
 *                                         ＝ どちらかのフラグが true なら該当（OR）
 *   last_name → 未定義                    ＝ 全員該当
 */
export const CORE_FIELD_GATES: Record<string, EmployeeBooleanField[]> = {
  /* 車両情報（マイカー通勤者だけが入力する） */
  car_model: ['has_car_commute'],
  car_plate_number: ['has_car_commute'],
  insurance_company: ['has_car_commute'],
  insurance_policy_number: ['has_car_commute'],
  insurance_expiry: ['has_car_commute'],
  vehicle_inspection_expiry: ['has_car_commute'],

  /* 免許情報（マイカー通勤者 OR 送迎運転者のどちらかが入力する） */
  license_type: ['has_car_commute', 'is_shuttle_driver'],
  license_number: ['has_car_commute', 'is_shuttle_driver'],
  license_expiry: ['has_car_commute', 'is_shuttle_driver'],
  license_image_path: ['has_car_commute', 'is_shuttle_driver'],
  license_image_back_path: ['has_car_commute', 'is_shuttle_driver'],

  /* 運転者情報（送迎運転者のみ） */
  driving_experience: ['is_shuttle_driver'],
  accident_history: ['is_shuttle_driver'],
  training_attendance: ['is_shuttle_driver'],

  /* commute_route_image_path / commute_method 等は全員（ゲート指定無し）*/
};

/**
 * 単一フィールドが当該社員に該当するか判定。
 * カスタムフィールドの場合は customFieldGates に gate_fields を渡す。
 */
export function isFieldApplicable(
  employee: Employee,
  fieldName: string,
  customFieldGates?: Map<string, string[]>,
): boolean {
  /* コアフィールドのゲートを優先 */
  const gates = CORE_FIELD_GATES[fieldName] ?? customFieldGates?.get(fieldName) ?? [];
  if (gates.length === 0) return true; /* ゲート無し = 全員該当 */

  /* OR: いずれかの gate flag が true なら該当 */
  return gates.some((g) => {
    const v = (employee as unknown as Record<string, unknown>)[g];
    return v === true;
  });
}

/**
 * 該当フィールドに「ゲート定義」が存在するか。
 * - true  → 「条件付きフィールド」（特定の人だけが該当）
 * - false → 「無条件フィールド」（氏名など、全員に該当）
 *
 * 書類の自動判定で「対象者を絞り込む手がかりになるタグかどうか」を見るのに使う。
 */
export function hasGateDefinition(
  fieldName: string,
  customFieldGates?: Map<string, string[]>,
): boolean {
  if ((CORE_FIELD_GATES[fieldName]?.length ?? 0) > 0) return true;
  if ((customFieldGates?.get(fieldName)?.length ?? 0) > 0) return true;
  return false;
}

/**
 * ゲートに登場する「フラグ名」を人間用ラベルに変換するための辞書。
 * 書類カードに「対象: マイカー通勤者」と表示する用途。
 */
export const GATE_FLAG_LABELS: Record<string, string> = {
  has_car_commute: 'マイカー通勤者',
  is_shuttle_driver: '送迎運転者',
};
