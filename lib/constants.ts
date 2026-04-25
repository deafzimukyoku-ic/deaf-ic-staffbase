// staffbase 主要定数 — SPEC.md 6章準拠
// 変更時は docs/reference-map.md の全参照を確認すること

export const MAX_DOCUMENTS_PER_TENANT = 10;
export const MAX_PAYROLL_BANKS_PER_TENANT = 3;
export const MAX_AI_DIAGNOSIS_PER_MONTH = 30;
export const MAX_DOCX_FILE_SIZE_MB = 5;
export const TRAINING_SUMMARY_MIN_CHARS = 150;
export const AI_MODEL = 'claude-haiku-4-5' as const;

export const PLACEHOLDER_REGEX = /\{\{([a-z_][a-z0-9_]*)\}\}/g;

export const MAPPING_SOURCE_TYPES = ['employee', 'tenant', 'form_data', 'fixed'] as const;
export type MappingSourceType = (typeof MAPPING_SOURCE_TYPES)[number];

export const INPUT_TYPES = ['text', 'textarea', 'date', 'number', 'select'] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const VISIBILITY_CONDITIONS = ['all', 'car_commute_only', 'shuttle_driver_only'] as const;
export type VisibilityCondition = (typeof VISIBILITY_CONDITIONS)[number];

export const EMPLOYEE_ROLES = ['employee', 'manager', 'admin'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EMPLOYEE_STATUS = ['active', 'retired'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUS)[number];

export const DOCUMENT_STATUS = ['draft', 'submitted', 'approved'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[number];

export const TRAINING_RESULT = ['pending', 'passed', 'failed', 'resubmit'] as const;
export type TrainingResult = (typeof TRAINING_RESULT)[number];

export const DIAGNOSIS_TYPES = ['personality', 'strengths', 'culture_fit', 'team_compat'] as const;
export type DiagnosisType = (typeof DIAGNOSIS_TYPES)[number];

// --- Shift-maker: 学年区分（migration 100 の children.grade_type CHECK と同期）---
export const GRADE_TYPES = [
  'preschool',
  'nursery_3', 'nursery_4', 'nursery_5',
  'elementary_1', 'elementary_2', 'elementary_3', 'elementary_4', 'elementary_5', 'elementary_6',
  'junior_high', 'junior_high_1', 'junior_high_2', 'junior_high_3',
  'high_1', 'high_2', 'high_3',
] as const;
export type GradeType = (typeof GRADE_TYPES)[number];

export const GRADE_LABELS: Record<GradeType, string> = {
  preschool: '未就学',
  nursery_3: '年少',
  nursery_4: '年中',
  nursery_5: '年長',
  elementary_1: '小1',
  elementary_2: '小2',
  elementary_3: '小3',
  elementary_4: '小4',
  elementary_5: '小5',
  elementary_6: '小6',
  junior_high_1: '中1',
  junior_high_2: '中2',
  junior_high_3: '中3',
  high_1: '高1',
  high_2: '高2',
  high_3: '高3',
  junior_high: '中学（旧）',
};

// 学年タブ用のグループ定義
export const GRADE_GROUPS = {
  all: { label: '全学年', grades: GRADE_TYPES },
  preschool: { label: '未就学・幼稚園', grades: ['preschool', 'nursery_3', 'nursery_4', 'nursery_5'] as GradeType[] },
  elementary: { label: '小学生', grades: ['elementary_1', 'elementary_2', 'elementary_3', 'elementary_4', 'elementary_5', 'elementary_6'] as GradeType[] },
  secondary: { label: '中高生', grades: ['junior_high_1', 'junior_high_2', 'junior_high_3', 'junior_high', 'high_1', 'high_2', 'high_3'] as GradeType[] },
} as const;
export type GradeGroupKey = keyof typeof GRADE_GROUPS;

// --- Shift-maker: 数値定数（CLAUDE.md §8 準拠）---
// 1送迎につき担当者は最大2名まで
export const MAX_STAFF_PER_TRANSPORT = 2;
// 有資格者の最低出勤数デフォルト（facility_shift_settings.min_qualified_staff で上書き可）
export const DEFAULT_MIN_QUALIFIED_STAFF = 2;
// 同一エリア・同一方向で前便との時刻差がこの分数未満なら同便扱い
export const TRANSPORT_TRIP_GAP_MINUTES = 30;
// 自動割り当ての担当人数（1 名固定。手動で 2 名追加する場合は UI から）
// shift-puzzle Phase 28: AUTO_ASSIGN_STAFF_COUNT
export const AUTO_ASSIGN_STAFF_COUNT = 1;
// 迎クールダウン（同職員を連続で迎に割り当てない間隔・分）
// shift-puzzle Phase 28: DEFAULT_PICKUP_COOLDOWN_MINUTES
export const DEFAULT_PICKUP_COOLDOWN_MINUTES = 45;
// 送迎担当の最低退勤時刻（これ以降に退勤する職員のみ送迎候補）
// shift-puzzle Phase 26: DEFAULT_TRANSPORT_MIN_END_TIME
export const DEFAULT_TRANSPORT_MIN_END_TIME = '16:31';
// 送迎表の列順デフォルト
export const DEFAULT_TRANSPORT_COLUMN_ORDER = [
  'pickup_time',
  'pickup_location',
  'pickup_staff',
  'dropoff_time',
  'dropoff_location',
  'dropoff_staff',
] as const;
export type TransportColumnKey = (typeof DEFAULT_TRANSPORT_COLUMN_ORDER)[number];

// --- Shift-maker: 公開ステータス（migration 100 publish_status enum と同期）---
export const PUBLISH_STATUSES = ['draft', 'ready', 'published'] as const;
export type PublishStatusConst = (typeof PUBLISH_STATUSES)[number];

// 送迎方向
export const TRANSPORT_DIRECTIONS = ['pickup', 'dropoff'] as const;
export type TransportDirection = (typeof TRANSPORT_DIRECTIONS)[number];
export const TRANSPORT_DIRECTION_LABELS: Record<TransportDirection, string> = {
  pickup: '迎え',
  dropoff: '送り',
};

// --- PDF テンプレート関連 ---
export const MAX_PDF_FILE_SIZE_MB = 20;
export const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export const DEFAULT_FONT_SIZE = 10;
/* タグ・PDF 描画フォント。IPAex 明朝（IPA Font License v1.0）を埋め込みで使用。
   MS 明朝とほぼ同等の字形で、Linux サーバ（Vercel）でも問題なくレンダリング可能。 */
export const FONT_FAMILY = 'IPAex Mincho' as const;
export const PDF_ASCENT_RATIO = 0.76;

export const TEMPLATE_TYPES = ['docx', 'pdf'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const DATA_MODES = ['employee', 'matrix'] as const;
export type DataMode = (typeof DATA_MODES)[number];

// --- プロフィールセクション表示制御 ---
export const PROFILE_SECTION_KEYS = [
  'basic_extended',
  'commute',
  'contacts',
  'intro',
  'work_style',
  'communication',
  'strengths',
  'values',
  'team',
] as const;
export type ProfileSectionKey = (typeof PROFILE_SECTION_KEYS)[number];

export const PROFILE_SECTION_LABELS: Record<ProfileSectionKey, string> = {
  basic_extended: '基本情報（詳細）',
  commute: '通勤・車両',
  contacts: '連絡先・保証人',
  intro: '自己紹介',
  work_style: 'ワークスタイル',
  communication: 'コミュニケーション',
  strengths: '強み・弱み',
  values: '価値観',
  team: 'チーム適性',
};
