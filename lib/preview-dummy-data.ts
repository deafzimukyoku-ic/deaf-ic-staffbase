/**
 * 書類テンプレ プレビュー用ダミーデータ
 *
 * 書類エディタの「サンプルプレビュー」ボタンで使用。
 * 先方データが一切無くてもタグ配置の見栄えを確認できるよう、
 * employees / tenants の全カラムを realistic なダミー値で埋める。
 *
 * 利用箇所:
 * - app/api/documents/generate-pdf/route.ts (preview=true 時)
 */

/* employees テーブル全カラム分のダミー値。
   実 DB の employee 型に近づけるため、boolean / number / null も適切に埋める。 */
export const DUMMY_EMPLOYEE: Record<string, unknown> = {
  id: 'preview-dummy',
  tenant_id: 'preview-dummy',
  auth_user_id: null,
  employee_number: 'EMP-0001',
  email: 'taro.yamada@example.com',
  role: 'employee',
  status: 'active',
  invited_at: null,

  // 基本情報
  last_name: '山田',
  first_name: '太郎',
  last_name_kana: 'ヤマダ',
  first_name_kana: 'タロウ',
  birth_date: '1990-04-01',
  gender: 'male',
  postal_code: '460-0008',
  address: '愛知県名古屋市中区栄三丁目1-1',
  phone: '090-1234-5678',
  position: '介護福祉士',
  position_id: null,
  years_of_service: 3,
  job_type: '生活支援員',
  work_location: '名古屋ろう国際センター 本部',
  facility_id: null,
  join_date: '2023-04-01',
  retirement_date: null,
  retirement_reason: null,

  // 振込先口座
  bank_name: 'ゆうちょ銀行',
  bank_branch_name: '12345',
  bank_account_type: 'ordinary',
  bank_account_number: '12345678',
  bank_account_holder: 'ヤマダ タロウ',

  // 通勤フラグ
  has_car_commute: true,
  is_shuttle_driver: true,

  // 車両・免許
  car_model: 'トヨタ プリウス',
  car_plate_number: '名古屋 300 あ 1234',
  license_type: '普通自動車第一種',
  license_number: '123456789012',
  license_expiry: '2028-04-01',
  insurance_company: '東京海上日動火災保険',
  insurance_policy_number: 'POL-987654321',
  insurance_expiry: '2027-03-31',
  vehicle_inspection_expiry: '2026-12-15',
  parking_location: '社員駐車場 A-12',
  commute_distance: '8.5',

  // 運転関連
  driving_experience: '2010年〜現在 / 普通車・送迎車両運転 約14年',
  accident_history: 'なし',
  training_attendance: '2024年度 安全運転講習 受講済',

  // 公共交通通勤
  commute_method: 'public_transport',
  commute_time_minutes: 35,
  route_section1_route: '自宅最寄り → 栄',
  route_section1_transport: '地下鉄東山線',
  route_section1_cost: 280,
  route_section2_route: '栄 → 久屋大通',
  route_section2_transport: '地下鉄名城線',
  route_section2_cost: 210,
  commute_route_detail: '自宅→○○駅→栄駅→徒歩5分→施設',

  // 画像系（プレビューでは使わないので null）
  license_image_path: null,
  license_image_back_path: null,
  commute_route_image_path: null,

  // 緊急連絡先1
  emergency1_name: '山田 花子',
  emergency1_relationship: '配偶者',
  emergency1_phone: '052-123-4567',
  emergency1_mobile: '080-1234-5678',
  emergency1_postal_code: '460-0008',
  emergency1_address: '愛知県名古屋市中区栄三丁目1-1',
  // 緊急連絡先2
  emergency2_name: '山田 一郎',
  emergency2_relationship: '父',
  emergency2_phone: '052-234-5678',
  emergency2_mobile: '080-2345-6789',
  emergency2_postal_code: '466-0064',
  emergency2_address: '愛知県名古屋市昭和区鶴舞一丁目2-3',

  // 身元保証人
  guarantor_name: '山田 一郎',
  guarantor_birth_date: '1960-08-15',
  guarantor_postal_code: '466-0064',
  guarantor_address: '愛知県名古屋市昭和区鶴舞一丁目2-3',
  guarantor_phone: '052-234-5678',
  guarantor_relationship: '父',

  // その他テキスト系
  self_introduction: 'プレビュー用ダミーデータです。',
  current_duties: '日常生活支援、送迎業務',
  past_duties: '介護施設での勤務経験あり',
  qualifications: ['介護福祉士', '普通自動車第一種'],
  efforts_focused_on: 'チームでの情報共有',
  how_others_describe: '誠実、責任感がある',
  values_and_motivation: '人の役に立つ仕事をしたい',

  my_number: '123456789012',
  previous_employer: '株式会社サンプル介護',

  custom_fields: {},
};

/* tenants テーブル分のダミー値（NPO 本部の代わり） */
export const DUMMY_TENANT: Record<string, unknown> = {
  id: 'preview-dummy',
  company_name: '認定NPO法人 名古屋ろう国際センター',
  representative_title: '理事長',
  representative_name: '代表 太郎',
  representative_honorific: '様',
  company_philosophy: null,
  action_guidelines: null,
  core_values: null,
  valued_behaviors: null,
  avoided_behaviors: null,
  ideal_culture: null,
  is_internal: true,
};

/* tenant.bank_name タグの返り値 */
export const DUMMY_BANK_NAME = 'ゆうちょ銀行';

/* employee.facility_name / employee.facility_address タグの返り値。
   IPAex 明朝には絵文字グリフが無く tofu (□×) になるため、絵文字は入れない。
   実運用では facilities.name に絵文字 prefix が付くケースがあるが、それは別途
   PDF 出力時に除去するか、本番側で絵文字無しの名前を使う運用で回避する。 */
export const DUMMY_FACILITY_NAME = '名古屋ろう国際センター 本部事業所';
export const DUMMY_FACILITY_ADDRESS = '愛知県名古屋市中区栄三丁目1-1';
