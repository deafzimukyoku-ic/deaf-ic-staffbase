/**
 * 社員フィールド値の表示用整形（日本語化）
 *
 * employees テーブルの enum 系カラム（gender / bank_account_type / commute_method 等）は
 * DB に英語識別子で保存されているため、PDF / docx へ差し込む前に日本語へ変換する。
 *
 * 利用箇所:
 * - lib/pdf/resolve-pdf-values.ts
 * - lib/docx/fill-template.ts
 */

/**
 * 文字列から絵文字 + ZWJ + 先頭の空白類を除去。
 * 主用途: facilities.name 先頭の "🏢 " prefix を書類出力時だけ剥がす
 *        (IPAex 明朝に絵文字グリフが無く □× で tofu 化するため)。
 * Unicode property escape \p{Extended_Pictographic} で絵文字本体、
 * \p{Emoji_Modifier} と ‍ (ZWJ) で複合絵文字も網羅。
 */
export function stripEmojiForPdf(value: string): string {
  if (!value) return '';
  return value
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, '')
    .replace(/^\s+|\s+$/g, '');
}

/* 日付カラム（YYYY-MM-DD → 年月日 表記に変換する対象） */
export const DATE_FIELDS = new Set([
  'birth_date',
  'join_date',
  'license_expiry',
  'insurance_expiry',
  'vehicle_inspection_expiry',
  'retirement_date',
  'guarantor_birth_date',
]);

/* enum → 日本語マップ。
   キーは employees テーブルのカラム名、値は DB enum 値 → 表示文字列。 */
const ENUM_TRANSLATIONS: Record<string, Record<string, string>> = {
  gender: {
    male: '男性',
    female: '女性',
    other: 'その他',
  },
  bank_account_type: {
    ordinary: '普通',
    current: '当座',
    savings: '貯蓄',
  },
  commute_method: {
    public_transport: '公共交通機関',
  },
};

/** "1992-05-01" → "1992年5月1日" */
function formatDateJP(value: string): string {
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

/**
 * employees テーブルの値を表示用に整形。
 * - 日付カラム: YYYY-MM-DD → 年月日表記
 * - enum カラム: 英語識別子 → 日本語表示
 * - 通勤手段（合成）: has_car_commute と commute_method を両方見て「マイカー」「公共交通機関」を組合せ
 * - それ以外: 文字列化のみ
 *
 * @param fieldName employees テーブルのカラム名
 * @param rawValue  そのカラムの値
 * @param employee  （任意）他カラムも参照する合成出力のためのフルレコード
 */
export function formatEmployeeFieldValue(
  fieldName: string,
  rawValue: unknown,
  employee?: Record<string, unknown>
): string {
  /* 通勤手段は has_car_commute（マイカー） + commute_method（公共交通）の合成。
     送迎運転者 (is_shuttle_driver) は「業務担当」であって通勤手段ではないため含めない。 */
  if (fieldName === 'commute_method' && employee) {
    const labels: string[] = [];
    if (employee.has_car_commute === true) labels.push('マイカー');
    if (employee.commute_method === 'public_transport') labels.push('公共交通機関');
    return labels.join('・');
  }

  if (rawValue === null || rawValue === undefined || rawValue === '') return '';

  /* 配列カラム（qualifications 等）は「、」で結合。
     String([...]) だと "a,b" になり PDF/docx で違和感があるため。 */
  if (Array.isArray(rawValue)) {
    return rawValue.filter((v) => v !== null && v !== undefined && v !== '').join('、');
  }

  const str = String(rawValue);

  /* enum 変換は最優先（マップに無い値は素通し） */
  const enumMap = ENUM_TRANSLATIONS[fieldName];
  if (enumMap && enumMap[str]) return enumMap[str];

  if (DATE_FIELDS.has(fieldName)) return formatDateJP(str);

  return str;
}
