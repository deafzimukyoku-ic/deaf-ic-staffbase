// AI診断ごとの使用カラム定義 — SPEC.md 8章準拠

export const DIAGNOSIS_FIELDS = {
  personality: [
    'last_name', 'first_name', 'position',
    'self_introduction', 'how_others_describe', 'values_and_motivation',
    'work_style_solo_vs_team', 'work_style_clear_vs_autonomy',
    'work_style_stable_vs_change', 'work_style_think_vs_act',
    'comm_conclusion_vs_context', 'comm_consult_timing',
    'meeting_behavior', 'relationship_notes',
    'ideal_boss_colleague', 'disliked_atmosphere', 'safe_environment',
  ],
  strengths: [
    'last_name', 'first_name', 'position', 'years_of_service',
    'current_duties', 'past_duties', 'qualifications', 'efforts_focused_on',
    'strength_1', 'strength_2', 'strength_3',
    'weakness_1', 'weakness_2', 'weakness_3',
    'success_experience', 'success_reason',
    'struggle_experience', 'struggle_reason',
    'suited_tasks', 'burden_tasks', 'growth_goal',
  ],
  cultureFit: [
    'last_name', 'first_name',
    'self_introduction', 'values_and_motivation', 'workplace_values',
    'ideal_boss_colleague', 'disliked_atmosphere',
    'growth_goal', 'preferred_evaluation', 'safe_environment',
  ],
  teamCompat: [
    'last_name', 'first_name', 'position',
    'self_introduction',
    'work_style_solo_vs_team', 'work_style_clear_vs_autonomy',
    'work_style_stable_vs_change', 'work_style_think_vs_act',
    'comm_conclusion_vs_context', 'comm_consult_timing', 'meeting_behavior',
    'strength_1', 'strength_2', 'strength_3',
    'weakness_1', 'weakness_2', 'weakness_3',
    'suited_tasks', 'burden_tasks',
    'team_role_preference', 'easy_to_work_with', 'hard_to_work_with', 'team_mindset',
  ],
} as const;

export type DiagnosisFieldKey = keyof typeof DIAGNOSIS_FIELDS;
