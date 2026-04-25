import type {
  MappingSourceType,
  InputType,
  VisibilityCondition,
  EmployeeRole,
  EmployeeStatus,
  DocumentStatus,
  TrainingResult,
  DiagnosisType,
  TemplateType,
  DataMode,
  ProfileSectionKey,
} from './constants';

// --- Tenants ---
export interface Tenant {
  id: string;
  company_name: string;
  representative_title: string;
  representative_name: string;
  representative_honorific: string;
  company_philosophy: string | null;
  action_guidelines: string | null;
  core_values: string | null;
  valued_behaviors: string | null;
  avoided_behaviors: string | null;
  ideal_culture: string | null;
  is_internal: boolean;
  setup_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantPayrollBank {
  id: string;
  tenant_id: string;
  bank_name: string;
  display_order: number;
  is_default: boolean;
}

// --- Employees ---
export interface Employee {
  id: string;
  tenant_id: string;
  auth_user_id: string | null;
  employee_number: string;
  email: string;
  role: EmployeeRole;
  status: EmployeeStatus;
  invited_at: string | null;
  // 1-1 基本情報
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  birth_date: string;
  gender: string | null;
  postal_code: string;
  address: string;
  phone: string;
  position: string | null;
  position_id: string | null;
  years_of_service: number | null;
  job_type: string | null;
  work_location: string | null;
  facility_id: string | null;
  join_date: string;
  retirement_date: string | null;
  retirement_reason: string | null;
  // 振込先口座
  bank_name: string | null;
  bank_branch_name: string | null;
  bank_account_type: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  has_car_commute: boolean;
  is_shuttle_driver: boolean;
  // マイカー通勤詳細
  car_model: string | null;
  car_plate_number: string | null;
  license_type: string | null;
  license_number: string | null;
  license_expiry: string | null;
  insurance_company: string | null;
  insurance_policy_number: string | null;
  insurance_expiry: string | null;
  vehicle_inspection_expiry: string | null;
  parking_location: string | null;
  commute_distance: string | null;
  // 運転関連（マイカー通勤・送迎共通）
  driving_experience: string | null;
  accident_history: string | null;
  training_attendance: string | null;
  // 通勤手段・区間
  commute_method: string | null;
  commute_time_minutes: number | null;
  route_section1_route: string | null;
  route_section1_transport: string | null;
  route_section1_cost: number | null;
  route_section2_route: string | null;
  route_section2_transport: string | null;
  route_section2_cost: number | null;
  commute_route_detail: string | null;
  // 画像
  license_image_path: string | null;
  license_image_back_path: string | null; // 裏面（migration 117）
  commute_route_image_path: string | null;
  // 緊急連絡先1
  emergency1_name: string | null;
  emergency1_relationship: string | null;
  emergency1_phone: string | null;
  emergency1_mobile: string | null;
  emergency1_postal_code: string | null;
  emergency1_address: string | null;
  // 緊急連絡先2
  emergency2_name: string | null;
  emergency2_relationship: string | null;
  emergency2_phone: string | null;
  emergency2_mobile: string | null;
  emergency2_postal_code: string | null;
  emergency2_address: string | null;
  // 身元保証人
  guarantor_name: string | null;
  guarantor_birth_date: string | null;
  guarantor_postal_code: string | null;
  guarantor_address: string | null;
  guarantor_phone: string | null;
  guarantor_relationship: string | null;
  // 1-2 自己紹介・業務経歴
  self_introduction: string | null;
  current_duties: string | null;
  past_duties: string | null;
  qualifications: string | null;
  efforts_focused_on: string | null;
  how_others_describe: string | null;
  values_and_motivation: string | null;
  // 1-3 働き方の好み
  work_style_solo_vs_team: string | null;
  work_style_clear_vs_autonomy: string | null;
  work_style_stable_vs_change: string | null;
  work_style_think_vs_act: string | null;
  multitask_ability: string | null;
  detail_orientation: string | null;
  // 1-4 コミュニケーション傾向
  comm_conclusion_vs_context: string | null;
  comm_consult_timing: string | null;
  comm_feedback_preference: string | null;
  comm_channel_preference: string | null;
  meeting_behavior: string | null;
  relationship_notes: string | null;
  // 1-5 強み・弱み
  strength_1: string | null;
  strength_2: string | null;
  strength_3: string | null;
  weakness_1: string | null;
  weakness_2: string | null;
  weakness_3: string | null;
  success_experience: string | null;
  success_reason: string | null;
  struggle_experience: string | null;
  struggle_reason: string | null;
  suited_tasks: string | null;
  burden_tasks: string | null;
  // 1-6 価値観・カルチャー
  workplace_values: string | null;
  ideal_boss_colleague: string | null;
  disliked_atmosphere: string | null;
  growth_goal: string | null;
  preferred_evaluation: string | null;
  safe_environment: string | null;
  strengths_self_reported: string | null;
  work_style_preference: string | null;
  // 1-7 チーム相性
  team_role_preference: string | null;
  easy_to_work_with: string | null;
  hard_to_work_with: string | null;
  team_mindset: string | null;
  // 追加フィールド
  my_number: string | null;
  previous_employer: string | null;
  // カスタムフィールド
  custom_fields: Record<string, string> | null;
  // 誓約
  pledge_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

// --- Facilities ---
// migration 116 で display_order / shift_enabled / transport_enabled 追加。
export interface Facility {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  created_at: string;
  display_order?: number;
  shift_enabled?: boolean;
  transport_enabled?: boolean;
}

// --- Shift-maker: 児童・送迎エリア ---
// エリアラベル: 絵文字 + 名前 + 標準送迎時刻（任意）。
// facility_shift_settings.pickup/dropoff_area_labels（共通） と
// children.custom_pickup/dropoff_areas（児童別カスタム） の両方に格納
export interface AreaLabel {
  id: string;       // クライアント生成 UUID（送迎表で参照される）
  emoji: string;    // 🏠 等の絵文字
  name: string;     // "自宅" 等の日本語名
  time?: string;    // 標準送迎時刻 HH:MM
  address?: string; // 住所（任意）。送り時に自宅住所のフォールバックとして使用
}

// child_area_eligible_staff 行（shift-puzzle の ChildAreaEligibleStaffRow 相当）
export interface ChildAreaEligibleStaffRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  child_id: string;
  area_id: string;
  employee_id: string;
  direction: 'pickup' | 'dropoff';
  created_at: string;
}

// 資格タイプ（facility_shift_settings.qualification_types に格納）
export interface QualificationType {
  name: string;         // "保育士" 等
  countable: boolean;   // true = 有資格者最低人数にカウント
}

// facility_shift_settings テーブル
export interface FacilityShiftSettings {
  facility_id: string;
  tenant_id: string;
  min_qualified_staff: number;
  pickup_area_labels: AreaLabel[];
  dropoff_area_labels: AreaLabel[];
  qualification_types: QualificationType[];
  request_deadline_day: number;
  transport_min_end_time: string; // HH:MM:SS
  transport_pickup_cooldown_minutes: number;
  updated_at: string;
}

// 職員管理（shift-maker 固有編集項目。社員管理の employees に merge 済み）
export type EmploymentType = 'full_time' | 'part_time';

export interface StaffShiftFields {
  employment_type: EmploymentType;
  default_start_time: string | null;  // HH:MM:SS
  default_end_time: string | null;
  pickup_transport_areas: string[];   // facility の pickup_area_labels.id 配列
  dropoff_transport_areas: string[];
  qualifications: string[];           // QualificationType.name の配列
  is_qualified: boolean;
  is_driver: boolean;
  is_attendant: boolean;
  shift_display_order: number | null;
}

export interface ChildRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  name: string;
  grade_type: import('./constants').GradeType;
  is_active: boolean;
  display_order: number | null;
  home_address: string | null;
  parent_contact: string | null;
  // pickup/dropoff_area_labels は area id の配列（custom_areas のうち「この児童にとって有効」なもの）
  pickup_area_labels: string[];
  dropoff_area_labels: string[];
  // この児童専用のエリア定義
  custom_pickup_areas: AreaLabel[];
  custom_dropoff_areas: AreaLabel[];
  created_at: string;
}

// --- Shift-maker: 利用予定 ---
// Phase 4 Step 2-Full: shift-puzzle に合わせて 'leave' を追加（migration 105）
export type AttendanceStatus = 'planned' | 'present' | 'absent' | 'late' | 'early_leave' | 'leave';

export interface ScheduleEntryRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  child_id: string;
  date: string; // YYYY-MM-DD
  pickup_time: string | null; // HH:MM:SS
  dropoff_time: string | null;
  pickup_mark: string | null;  // AreaLabel.id or null
  dropoff_mark: string | null; // AreaLabel.id or null
  pickup_method: 'self' | 'pickup';     // migration 105
  dropoff_method: 'self' | 'dropoff';   // migration 105
  note: string | null;                   // migration 105
  is_confirmed: boolean;
  attendance_status: AttendanceStatus;
  attendance_updated_at: string | null;
  attendance_updated_by: string | null;
  created_at: string;
}

// PDFやExcelのインポート結果（行単位でパースされたエントリ）
export interface ParsedScheduleEntry {
  child_name: string;
  date: string; // YYYY-MM-DD
  pickup_time: string | null;
  dropoff_time: string | null;
  pickup_method?: 'self' | 'pickup';
  dropoff_method?: 'self' | 'dropoff';
  pickup_mark?: string | null;
  dropoff_mark?: string | null;
  /** Claude のPDF解析が返す生のエリアラベル文字列 / インポート時の特殊ステータス（追・休 等） */
  area_label?: string | null;
}

// 出欠監査ログ
export interface AttendanceAuditLogRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  schedule_entry_id: string;
  entry_date: string;
  child_id: string;
  old_status: AttendanceStatus | null;
  new_status: AttendanceStatus;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

// --- Positions ---
// migration 115 で system_role 列と同期トリガーを削除。役職は純粋なラベル。
export interface Position {
  id: string;
  tenant_id: string;
  name: string;
  display_order: number;
  created_at: string;
}

// --- Custom Employee Fields ---
export type CustomFieldType = 'text' | 'date' | 'number' | 'select' | 'image';

export interface CustomEmployeeField {
  id: string;
  tenant_id: string;
  field_key: string;
  label: string;
  field_type: CustomFieldType;
  options: string[];
  display_order: number;
  is_active: boolean;
  created_at: string;
}

// --- Documents ---
export interface PlaceholderMapping {
  key: string;
  source_type: MappingSourceType;
  source_field: string;
  label: string | null;
  input_type: InputType | null;
  options: string[] | null;
  required: boolean | null;
}

export interface DocumentTemplate {
  id: string;
  tenant_id: string | null;
  name: string;
  docx_storage_path: string | null;
  mapping: PlaceholderMapping[];
  visibility_condition: VisibilityCondition;
  is_sample: boolean;
  display_order: number;
  // PDF テンプレート用フィールド
  pdf_storage_path: string | null;
  page_count: number | null;
  template_type: TemplateType;
  data_mode: DataMode;
  created_at: string;
}

export interface DocumentSubmission {
  id: string;
  employee_id: string;
  document_template_id: string;
  form_data: Record<string, unknown>;
  status: DocumentStatus;
  submitted_at: string | null;
  generated_docx_path: string | null;
  created_at: string;
  updated_at: string;
}

// --- PDF Tags ---
export interface PdfTag {
  id: string;
  template_id: string;
  column_key: string;
  display_name: string;
  created_at: string;
}

// --- PDF Tag Placements ---
export interface PdfTagPlacement {
  id: string;
  tag_id: string;
  template_id: string;
  page_number: number;
  x: number;
  y: number;
  font_size: number;
  created_at: string;
  updated_at: string;
}

// --- Matrix Rows ---
export interface MatrixRow {
  id: string;
  template_id: string;
  row_index: number;
  row_data: Record<string, string>;
  created_at: string;
  updated_at: string;
}

// --- Categories ---
// 遵守事項・研修・お知らせ共通のテナント定義カテゴリ
// icon は絵文字1文字想定（lucide-react バンドル増回避のため任意入力）
// color はアプリ側プリセット10色のHEX文字列
export type CategoryType = 'compliance' | 'training' | 'announcement' | 'manual';

export type ContentBlockJson =
  | { type: 'text'; value: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'video'; url: string; source: 'youtube' | 'google_drive' }
  | { type: 'pdf'; url: string; label?: string };

export interface Manual {
  id: string;
  tenant_id: string;
  title: string;
  body: string;
  pdf_storage_path: string | null;
  content_blocks?: ContentBlockJson[];
  category_id: string | null;
  target_type: 'all' | 'facility';
  target_facility_ids: string[];
  target_position_ids: string[];
  created_by: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  sort_order: number | null;
  creator?: PersonRef | null;
  editor?: PersonRef | null;
}

// 作成者・編集者などの参照先 employee の最小フィールド
// employees テーブルに full_name は存在しないため last_name + first_name + email のみ
export interface PersonRef {
  last_name: string | null;
  first_name: string | null;
  email: string | null;
}

export interface Category {
  id: string;
  tenant_id: string;
  type: CategoryType;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

// --- Target Scope ---
// 遵守事項・研修・お知らせで共通の配信対象スコープ
// 'all' = テナント全社員、'facility' = target_facility_ids の施設所属社員のみ
// facility_id が NULL の社員は target_type='all' のコンテンツのみ閲覧可能
export type TargetType = 'all' | 'facility';

// --- Compliance ---
export interface ComplianceDoc {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  admin_comment: string | null;
  updated_at: string;
  created_at?: string;
  category_id: string | null;
  target_type: TargetType;
  target_facility_ids: string[];
  target_position_ids: string[];
  sort_order?: number | null;
  content_blocks?: ContentBlockJson[];
  created_by?: string;
  updated_by?: string | null;
  creator?: PersonRef | null;
  editor?: PersonRef | null;
}

export interface ComplianceAcknowledgment {
  id: string;
  employee_id: string;
  compliance_document_id: string;
  acknowledged_at: string;
}

// --- Trainings ---
export interface Training {
  id: string;
  tenant_id: string;
  title: string;
  body?: string;
  pdf_storage_path: string | null;
  youtube_url: string | null;
  created_at: string;
  category_id: string | null;
  target_type: TargetType;
  target_facility_ids: string[];
  target_position_ids: string[];
  sort_order?: number | null;
  content_blocks?: ContentBlockJson[];
  created_by?: string;
  updated_by?: string | null;
  creator?: PersonRef | null;
  editor?: PersonRef | null;
}

export interface TrainingSubmission {
  id: string;
  training_id: string;
  employee_id: string;
  summary_text: string;
  result: TrainingResult;
  admin_comment: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}

// --- Announcements ---
export interface Announcement {
  id: string;
  tenant_id: string;
  title: string;
  body: string;
  category_id: string | null;
  target_type: TargetType;
  target_facility_ids: string[];
  target_position_ids: string[];
  sort_order: number | null;
  content_blocks?: ContentBlockJson[];
  created_at: string;
  created_by: string | null;
  updated_by?: string | null;
  creator?: PersonRef | null;
  editor?: PersonRef | null;
}

export interface AnnouncementRead {
  announcement_id: string;
  employee_id: string;
  read_at: string;
}

// --- Notification Queue ---
// 作成/編集から2時間後にメール配信するためのキュー
// 編集時は同一(content_type, content_id)の未送信行をUPDATEしてscheduled_atリセット
// created_by は enqueue 時の投稿者。flush時にこの社員は宛先から除外
//
// migration 106 で 'shift_ready' / 'shift_publish' を追加。
// シフト系は content_id を使わず facility_id + meta JSON を使う。
// 既存4タイプ（business content）。notification-email.ts はこちらを使用。
// migration 091 で manual を追加したが、CHECK 制約と各 API への追従は migration 109 で修正
export type LegacyNotificationContentType = 'announcement' | 'compliance' | 'training' | 'manual';
// シフト系（migration 106）。shift-notification-email.ts で別処理。
export type ShiftNotificationContentType = 'shift_ready' | 'shift_publish';
export type NotificationContentType = LegacyNotificationContentType | ShiftNotificationContentType;

export interface NotificationQueue {
  id: string;
  tenant_id: string;
  content_type: NotificationContentType;
  content_id: string | null;
  // migration 106: シフト系専用カラム（既存3タイプではNULL）
  facility_id: string | null;
  meta: Record<string, unknown> | null;
  scheduled_at: string;
  sent_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
}

// --- Shift: 公開ステータス（migration 100 で enum 定義） ---
export type PublishStatus = 'draft' | 'ready' | 'published';

// --- Shift: 職員行 (shift-puzzle StaffRow 互換 projection) ---
// employees から shift で必要な項目だけを抽出した形。
// shift-puzzle 由来 UI が `name` `is_qualified` 等を直接読むため互換のため維持。
// id = employees.id, name = staffDisplayName(employee)
export interface StaffRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  name: string;
  email: string | null;
  role: 'admin' | 'manager' | 'employee';
  employment_type: EmploymentType;
  default_start_time: string | null;
  default_end_time: string | null;
  pickup_transport_areas: string[];
  dropoff_transport_areas: string[];
  qualifications: string[];
  is_qualified: boolean;
  is_driver: boolean;
  is_attendant: boolean;
  shift_display_order: number | null;
}

// --- Shift: 休み希望 ---
export type ShiftRequestType =
  | 'public_holiday'
  | 'paid_leave'
  | 'full_day_available'
  | 'am_off'
  | 'pm_off'
  | 'comment';

export interface ShiftRequestRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  employee_id: string; // shift-puzzle の staff_id 相当
  month: string; // YYYY-MM
  request_type: ShiftRequestType;
  dates: string[];
  notes: string | null;
  submitted_at: string;
  // 入力者 id。NULL or = employee_id なら本人、異なれば代理入力
  submitted_by_employee_id: string | null;
}

// --- Shift: 確定 ---
export type ShiftAssignmentType = 'normal' | 'public_holiday' | 'paid_leave' | 'off';

export interface ShiftAssignmentRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  start_time: string | null;
  end_time: string | null;
  assignment_type: ShiftAssignmentType;
  is_confirmed: boolean;
  publish_status: PublishStatus;
  segment_order: number;
  note: string | null;
  created_at: string;
}

// --- Shift: 送迎担当（migration 112 で配列スキーマに移行） ---
// 1 行 = 1 schedule_entry。pickup/dropoff 両方を配列で保持（最大2名想定）
export interface TransportAssignmentRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  schedule_entry_id: string;
  // shift-puzzle の pickup_staff_ids / dropoff_staff_ids を employee 命名に統一
  pickup_employee_ids: string[];
  dropoff_employee_ids: string[];
  is_confirmed: boolean;
  is_unassigned: boolean;
  is_locked: boolean;
  publish_status: PublishStatus;
  created_at: string;
}

// --- Shift: 変更申請（公開後/仮シフトへのフィードバック）---
export type ShiftChangeRequestType =
  | 'time'         // 出勤時刻の変更
  | 'leave'        // 休暇申請（assignment_type を paid_leave / public_holiday 等に）
  | 'type_change'; // 勤務種別変更

export type ShiftChangeRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

// change_type='time' の requested_payload
export interface ShiftChangeTimePayload {
  start_time: string; // "HH:MM"
  end_time: string;
}

// change_type='leave' / 'type_change' の requested_payload
export interface ShiftChangeTypePayload {
  assignment_type: ShiftAssignmentType;
  // 時刻変更も同時に行う場合
  start_time?: string | null;
  end_time?: string | null;
}

export type ShiftChangeRequestPayload =
  | ShiftChangeTimePayload
  | ShiftChangeTypePayload;

export interface ShiftChangeRequestRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  employee_id: string;
  target_date: string;
  change_type: ShiftChangeRequestType;
  requested_payload: ShiftChangeRequestPayload;
  // 申請時点の shift_assignments スナップショット（差分表示用）
  snapshot_before: Partial<ShiftAssignmentRow> | null;
  reason: string | null;
  status: ShiftChangeRequestStatus;
  reviewed_by_employee_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

// --- AI Diagnosis ---
export interface AIDiagnosis {
  id: string;
  tenant_id: string;
  diagnosis_type: DiagnosisType;
  target_employee_ids: string[];
  result_text: string;
  created_at: string;
}

export interface AIDiagnosisUsage {
  tenant_id: string;
  year_month: string;
  count: number;
}

// --- Profile Section Visibility ---
export interface ProfileSectionVisibility {
  id: string;
  tenant_id: string;
  section_key: ProfileSectionKey;
  is_visible: boolean;
  created_at: string;
}

// --- Progress View ---
// migration 110 で manuals_read を追加
export interface EmployeeProgress {
  employee_id: string;
  tenant_id: string;
  facility_id?: string | null;
  docs_submitted: number;
  compliance_done: number;
  trainings_passed: number;
  announcements_read: number;
  manuals_read: number;
}
