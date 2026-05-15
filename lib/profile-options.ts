/**
 * 社員プロフィール「働き方の好み」「コミュニケーション傾向」の選択肢定義（単一の真実源）。
 *
 * 入力フォーム（components/employee/ProfileSection3WorkStyle / ProfileSection4Comm）と
 * 表示側（components/manager/SubordinateDetail 等）がこの定義を共有することで、
 * DB に保存される値（solo / proactive 等）と日本語ラベルの対応を一箇所に集約し、
 * 「表示側だけ英語の生値が出る」ラベル drift を防ぐ。
 *
 * 注意: comm_consult_timing と comm_feedback_preference は同じ value（immediate / organized）を
 * 使うが日本語ラベルは異なるため、value→label はフィールド単位で持つ必要がある。
 */

export type WorkStyleFieldKey =
  | 'work_style_solo_vs_team'
  | 'work_style_clear_vs_autonomy'
  | 'work_style_stable_vs_change'
  | 'work_style_think_vs_act'
  | 'multitask_ability'
  | 'detail_orientation';

export type CommSelectFieldKey =
  | 'comm_conclusion_vs_context'
  | 'comm_consult_timing'
  | 'comm_feedback_preference'
  | 'comm_channel_preference'
  | 'meeting_behavior';

export interface ProfileSelectField<K extends string> {
  key: K;
  /** 入力フォームに表示するフィールド見出し */
  label: string;
  options: { value: string; label: string }[];
}

export const WORK_STYLE_FIELDS: ProfileSelectField<WorkStyleFieldKey>[] = [
  { key: 'work_style_solo_vs_team', label: '個人作業 vs チーム作業', options: [
    { value: 'solo', label: '個人作業が好き' }, { value: 'team', label: 'チーム作業が好き' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'work_style_clear_vs_autonomy', label: '明確な指示 vs 自律的に', options: [
    { value: 'clear', label: '明確な指示がほしい' }, { value: 'autonomy', label: '自律的に進めたい' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'work_style_stable_vs_change', label: '安定志向 vs 変化志向', options: [
    { value: 'stable', label: '安定した環境がいい' }, { value: 'change', label: '変化がある方がいい' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'work_style_think_vs_act', label: 'じっくり考える vs すぐ行動', options: [
    { value: 'think', label: 'じっくり考えてから' }, { value: 'act', label: 'まず行動してみる' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'multitask_ability', label: 'マルチタスク', options: [
    { value: 'good', label: '得意' }, { value: 'weak', label: '苦手' }, { value: 'neutral', label: 'どちらでもない' },
  ]},
  { key: 'detail_orientation', label: '細部へのこだわり', options: [
    { value: 'good', label: '得意' }, { value: 'weak', label: '苦手' }, { value: 'neutral', label: 'どちらでもない' },
  ]},
];

export const COMM_SELECT_FIELDS: ProfileSelectField<CommSelectFieldKey>[] = [
  { key: 'comm_conclusion_vs_context', label: '結論から話す vs 背景から話す', options: [
    { value: 'conclusion', label: '結論から' }, { value: 'context', label: '背景から' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'comm_consult_timing', label: '相談のタイミング', options: [
    { value: 'immediate', label: 'すぐに相談' }, { value: 'organized', label: 'まとめてから' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'comm_feedback_preference', label: 'フィードバックの受け方', options: [
    { value: 'immediate', label: 'その場ですぐ' }, { value: 'organized', label: '整理してから' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'comm_channel_preference', label: 'コミュニケーション手段', options: [
    { value: 'text', label: 'テキスト（チャット等）' }, { value: 'verbal', label: '口頭（対面等）' }, { value: 'either', label: 'どちらでも' },
  ]},
  { key: 'meeting_behavior', label: '会議での振る舞い', options: [
    { value: 'proactive', label: '積極的に発言' }, { value: 'observant', label: '聞き役が多い' }, { value: 'either', label: 'どちらでも' },
  ]},
];

/** フィールドキー → (DB 値 → 日本語ラベル) の逆引き表 */
const OPTION_LABEL_BY_FIELD: Record<string, Record<string, string>> = (() => {
  const map: Record<string, Record<string, string>> = {};
  for (const f of [...WORK_STYLE_FIELDS, ...COMM_SELECT_FIELDS]) {
    const inner: Record<string, string> = {};
    for (const o of f.options) inner[o.value] = o.label;
    map[f.key] = inner;
  }
  return map;
})();

/**
 * 働き方 / コミュニケーション系フィールドの DB 値を日本語ラベルに変換する。
 * 値が未設定なら '-'、定義外の値ならその値自体をそのまま返す（フォールバック）。
 */
export function profileOptionLabel(
  fieldKey: WorkStyleFieldKey | CommSelectFieldKey,
  value: string | null | undefined,
): string {
  if (!value) return '-';
  return OPTION_LABEL_BY_FIELD[fieldKey]?.[value] ?? value;
}
