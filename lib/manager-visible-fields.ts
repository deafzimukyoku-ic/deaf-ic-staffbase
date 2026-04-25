// マネージャーが部下について閲覧可能なフィールド一覧
// 基本個人情報（住所・電話・メール等）は含まない

import type { Employee } from './types';

export const MANAGER_VISIBLE_FIELDS: (keyof Employee)[] = [
  'id',
  'tenant_id',
  'employee_number',
  'status',
  // 氏名
  'last_name',
  'first_name',
  'last_name_kana',
  'first_name_kana',
  // 所属
  'position',
  'years_of_service',
  'job_type',
  'work_location',
  'join_date',
  // 通勤・送迎フラグ
  'has_car_commute',
  'is_shuttle_driver',
  // 運転関連
  'driving_experience',
  'accident_history',
  'training_attendance',
  // 1-2 自己紹介・業務経歴
  'self_introduction',
  'current_duties',
  'past_duties',
  'qualifications',
  'efforts_focused_on',
  'how_others_describe',
  'values_and_motivation',
  // 1-3 働き方の好み
  'work_style_solo_vs_team',
  'work_style_clear_vs_autonomy',
  'work_style_stable_vs_change',
  'work_style_think_vs_act',
  'multitask_ability',
  'detail_orientation',
  // 1-4 コミュニケーション傾向
  'comm_conclusion_vs_context',
  'comm_consult_timing',
  'comm_feedback_preference',
  'comm_channel_preference',
  'meeting_behavior',
  'relationship_notes',
  // 1-5 強み・弱み
  'strength_1',
  'strength_2',
  'strength_3',
  'weakness_1',
  'weakness_2',
  'weakness_3',
  'success_experience',
  'success_reason',
  'struggle_experience',
  'struggle_reason',
  'suited_tasks',
  'burden_tasks',
  // 1-6 価値観・カルチャー
  'workplace_values',
  'ideal_boss_colleague',
  'disliked_atmosphere',
  'growth_goal',
  'preferred_evaluation',
  'safe_environment',
  'strengths_self_reported',
  'work_style_preference',
  // 1-7 チーム相性
  'team_role_preference',
  'easy_to_work_with',
  'hard_to_work_with',
  'team_mindset',
];

// DB selectクエリ用のカラム文字列
export const MANAGER_VISIBLE_SELECT = MANAGER_VISIBLE_FIELDS.join(', ');
