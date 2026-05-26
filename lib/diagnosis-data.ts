/**
 * AI 診断 API 群が employees 行を AI に渡す前に、enum カラムを日本語ラベルに変換するヘルパー。
 *
 * 真因 (ORIGAMI-GRP-staffbase docs/error-log.md 2026-05-26 診断英語事案を本家にも移植):
 *   DB の enum 値 ('context' / 'conclusion' / 'organized' / 'immediate' 等) を
 *   JSON.stringify でそのまま AI に渡すと、AI が英語値を文章に混入させる
 *   (「XX さんが『context重視・organized相談』に対し...」のような出力)。
 *
 * 解決:
 *   既存の profileOptionLabel (lib/profile-options.ts) と同じラベル定義を通して、
 *   AI に渡す段階で日本語化する。AI は受け取った日本語値をそのまま出力に使うので、
 *   診断結果テキストも日本語表現になる。
 *
 *   その他のフィールド (text カラム = 自己紹介・力を入れたこと etc) は変換不要なので
 *   raw 値をそのまま渡す。
 */
import {
  profileOptionLabel,
  WORK_STYLE_FIELDS,
  COMM_SELECT_FIELDS,
  type WorkStyleFieldKey,
  type CommSelectFieldKey,
} from './profile-options';

/** profile-options が管理する enum フィールド一覧。Set にして O(1) 判定。 */
const SELECT_FIELD_KEY_SET: Set<string> = new Set([
  ...WORK_STYLE_FIELDS.map((f) => f.key),
  ...COMM_SELECT_FIELDS.map((f) => f.key),
]);

/**
 * employees 行から指定フィールドを抜き出し、enum カラムは日本語ラベルに変換した
 * 「AI に渡す用のデータ」に整形する。
 *
 * @param employee  employees テーブル 1 行 (全カラム入った Record)
 * @param fields    抽出するフィールド名一覧 (DIAGNOSIS_FIELDS.xxx)
 * @returns         AI に JSON.stringify で渡せる Record
 */
export function buildAiInputData(
  employee: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = employee[field];
    if (SELECT_FIELD_KEY_SET.has(field)) {
      data[field] = profileOptionLabel(
        field as WorkStyleFieldKey | CommSelectFieldKey,
        typeof raw === 'string' ? raw : null,
      );
    } else {
      data[field] = raw ?? null;
    }
  }
  return data;
}
