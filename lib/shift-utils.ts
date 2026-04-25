// shift-puzzle の lib/utils を deaf-ic 用に移植
// staffDisplayName: employees の氏名表示用（last_name + first_name）
// GRADE_LABELS / GRADE_MAP / parseChildName: 児童名自動パース

import { GRADE_LABELS, type GradeType } from '@/lib/constants';

export { GRADE_LABELS };

export interface StaffLike {
  last_name?: string | null;
  first_name?: string | null;
  name?: string | null;
  /** 送迎表用の短縮表示名（最大3文字）。shift-puzzle Phase 28 F案 互換。 */
  display_name?: string | null;
}

// employees の表示名。
// 優先順:
//   1) display_name（送迎表で設定された短縮名、3文字まで）
//   2) last_name + first_name
//   3) name フィールド
// shift-puzzle/lib/utils/displayName.ts の挙動を取り込んだ統合版。
export function staffDisplayName(s: StaffLike): string {
  const d = (s.display_name ?? '').trim();
  if (d) return d;
  const ln = (s.last_name ?? '').trim();
  const fn = (s.first_name ?? '').trim();
  if (ln || fn) return `${ln} ${fn}`.trim();
  return (s.name ?? '').trim();
}

// 児童名から学年を推定するマップ（shift-puzzle parseChildName.ts 由来）
const GRADE_MAP: Record<string, GradeType> = {
  '未就学': 'preschool',
  '年少': 'nursery_3',
  '年中': 'nursery_4',
  '年長': 'nursery_5',
  '小1': 'elementary_1',
  '小2': 'elementary_2',
  '小3': 'elementary_3',
  '小4': 'elementary_4',
  '小5': 'elementary_5',
  '小6': 'elementary_6',
  '中1': 'junior_high_1',
  '中2': 'junior_high_2',
  '中3': 'junior_high_3',
  '高1': 'high_1',
  '高2': 'high_2',
  '高3': 'high_3',
  '1': 'elementary_1', '2': 'elementary_2', '3': 'elementary_3',
  '4': 'elementary_4', '5': 'elementary_5', '6': 'elementary_6',
};

export interface ParsedChildName {
  name: string;
  grade: GradeType | null;
  gradeLabel: string | null;
}

export function parseChildName(raw: string): ParsedChildName {
  const cleaned = raw.trim();
  const match = cleaned.match(/^(.+?)\s*[\(（]([^)）]+)[\)）]\s*$/);
  if (match) {
    const name = match[1].trim();
    const rawGrade = match[2].trim();
    const grade = GRADE_MAP[rawGrade] ?? null;
    return { name, grade, gradeLabel: grade ? GRADE_LABELS[grade] : null };
  }
  return { name: cleaned, grade: null, gradeLabel: null };
}
