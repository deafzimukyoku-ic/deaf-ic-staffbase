/**
 * サンプル書類8種のグローバル登録スクリプト
 *
 * 実行: npx tsx seed/seed-samples.ts
 *
 * 前提:
 *   - .env.local に NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY を設定
 *   - seed/sample-documents/ に 8 つの docx ファイルが存在
 *   - Supabase Storage に "documents" バケットが作成済み
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ---------- サンプル書類定義 ----------

interface SampleDef {
  file: string;
  storageName: string;
  name: string;
  visibility_condition: 'all' | 'car_commute_only' | 'shuttle_driver_only';
  display_order: number;
  mapping: {
    key: string;
    source_type: 'employee' | 'tenant' | 'form_data' | 'fixed';
    source_field?: string;
    label?: string;
    input_type?: 'text' | 'textarea' | 'date' | 'number' | 'select';
    required?: boolean;
    options?: string[];
  }[];
}

const samples: SampleDef[] = [
  {
    file: '02-入社誓約書.docx',
    storageName: '02-nyusha-seiyakusho.docx',
    name: '入社誓約書',
    visibility_condition: 'all',
    display_order: 1,
    mapping: [
      { key: 'company_name', source_type: 'tenant', source_field: 'company_name' },
      { key: 'representative_title', source_type: 'tenant', source_field: 'representative_title' },
      { key: 'representative_name', source_type: 'tenant', source_field: 'representative_name' },
      { key: 'representative_honorific', source_type: 'tenant', source_field: 'representative_honorific' },
      { key: 'today', source_type: 'fixed', source_field: 'today' },
      { key: 'employee_number', source_type: 'employee', source_field: 'employee_number' },
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
    ],
  },
  {
    file: '03-身元保証書.docx',
    storageName: '03-mimoto-hoshosho.docx',
    name: '身元保証書',
    visibility_condition: 'all',
    display_order: 2,
    mapping: [
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
      { key: 'birth_date', source_type: 'employee', source_field: 'birth_date' },
      { key: 'join_date', source_type: 'employee', source_field: 'join_date' },
      { key: 'guarantor_postal_code', source_type: 'employee', source_field: 'guarantor_postal_code' },
      { key: 'guarantor_address', source_type: 'employee', source_field: 'guarantor_address' },
      { key: 'guarantor_phone', source_type: 'employee', source_field: 'guarantor_phone' },
      { key: 'guarantor_relationship', source_type: 'employee', source_field: 'guarantor_relationship' },
      { key: 'guarantor_name', source_type: 'employee', source_field: 'guarantor_name' },
      { key: 'guarantor_birth_date', source_type: 'employee', source_field: 'guarantor_birth_date' },
    ],
  },
  {
    file: '04-緊急連絡先.docx',
    storageName: '04-kinkyuu-renrakusaki.docx',
    name: '緊急連絡先届',
    visibility_condition: 'all',
    display_order: 3,
    mapping: [
      { key: 'company_name', source_type: 'tenant', source_field: 'company_name' },
      { key: 'representative_name', source_type: 'tenant', source_field: 'representative_name' },
      { key: 'representative_honorific', source_type: 'tenant', source_field: 'representative_honorific' },
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
      { key: 'emergency1_postal_code', source_type: 'employee', source_field: 'emergency1_postal_code' },
      { key: 'emergency1_address', source_type: 'employee', source_field: 'emergency1_address' },
      { key: 'emergency1_name', source_type: 'employee', source_field: 'emergency1_name' },
      { key: 'emergency1_phone', source_type: 'employee', source_field: 'emergency1_phone' },
      { key: 'emergency1_mobile', source_type: 'employee', source_field: 'emergency1_mobile' },
      { key: 'emergency1_relationship', source_type: 'employee', source_field: 'emergency1_relationship' },
      { key: 'emergency2_postal_code', source_type: 'employee', source_field: 'emergency2_postal_code' },
      { key: 'emergency2_address', source_type: 'employee', source_field: 'emergency2_address' },
      { key: 'emergency2_name', source_type: 'employee', source_field: 'emergency2_name' },
      { key: 'emergency2_phone', source_type: 'employee', source_field: 'emergency2_phone' },
      { key: 'emergency2_mobile', source_type: 'employee', source_field: 'emergency2_mobile' },
      { key: 'emergency2_relationship', source_type: 'employee', source_field: 'emergency2_relationship' },
    ],
  },
  {
    file: '05-給与振込依頼書.docx',
    storageName: '05-kyuuyo-furikomi.docx',
    name: '給与振込依頼書',
    visibility_condition: 'all',
    display_order: 4,
    mapping: [
      { key: 'today', source_type: 'fixed', source_field: 'today' },
      { key: 'company_name', source_type: 'tenant', source_field: 'company_name' },
      { key: 'representative_title', source_type: 'tenant', source_field: 'representative_title' },
      { key: 'representative_name', source_type: 'tenant', source_field: 'representative_name' },
      { key: 'representative_honorific', source_type: 'tenant', source_field: 'representative_honorific' },
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
      { key: 'bank_name', source_type: 'tenant', source_field: 'bank_name' },
      { key: 'branch_name', source_type: 'form_data', source_field: 'branch_name', label: '支店名', input_type: 'text', required: true },
      { key: 'deposit_type', source_type: 'form_data', source_field: 'deposit_type', label: '預金種類', input_type: 'select', required: true, options: ['普通', '当座'] },
      { key: 'account_number', source_type: 'form_data', source_field: 'account_number', label: '口座番号', input_type: 'text', required: true },
      { key: 'account_name_kana', source_type: 'form_data', source_field: 'account_name_kana', label: '口座名義（カナ）', input_type: 'text', required: true },
    ],
  },
  {
    file: '06-通勤経路申出書.docx',
    storageName: '06-tsuukin-keiro.docx',
    name: '通勤経路申出書',
    visibility_condition: 'all',
    display_order: 5,
    mapping: [
      { key: 'today', source_type: 'fixed', source_field: 'today' },
      { key: 'company_name', source_type: 'tenant', source_field: 'company_name' },
      { key: 'representative_title', source_type: 'tenant', source_field: 'representative_title' },
      { key: 'representative_name', source_type: 'tenant', source_field: 'representative_name' },
      { key: 'representative_honorific', source_type: 'tenant', source_field: 'representative_honorific' },
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
      { key: 'commute_method', source_type: 'form_data', source_field: 'commute_method', label: '通勤手段', input_type: 'select', required: true, options: ['電車', 'バス', '自転車', '徒歩', '自家用車', 'その他'] },
      { key: 'commute_time', source_type: 'form_data', source_field: 'commute_time', label: '通勤時間（分）', input_type: 'number', required: true },
      { key: 'commute_distance', source_type: 'form_data', source_field: 'commute_distance', label: '通勤距離（km）', input_type: 'number', required: true },
      { key: 'route_section1', source_type: 'form_data', source_field: 'route_section1', label: '区間1 乗車区間', input_type: 'text', required: false },
      { key: 'route_agency1', source_type: 'form_data', source_field: 'route_agency1', label: '区間1 利用機関', input_type: 'text', required: false },
      { key: 'route_cost1', source_type: 'form_data', source_field: 'route_cost1', label: '区間1 金額', input_type: 'number', required: false },
      { key: 'route_section2', source_type: 'form_data', source_field: 'route_section2', label: '区間2 乗車区間', input_type: 'text', required: false },
      { key: 'route_agency2', source_type: 'form_data', source_field: 'route_agency2', label: '区間2 利用機関', input_type: 'text', required: false },
      { key: 'route_cost2', source_type: 'form_data', source_field: 'route_cost2', label: '区間2 金額', input_type: 'number', required: false },
      { key: 'commute_route_detail', source_type: 'form_data', source_field: 'commute_route_detail', label: '通勤経路（詳細）', input_type: 'textarea', required: false },
    ],
  },
  {
    file: '08-運転許可申請兼運転者台帳(送迎).docx',
    storageName: '08-unten-kyoka-sougei.docx',
    name: '運転許可申請兼運転者台帳（送迎）',
    visibility_condition: 'shuttle_driver_only',
    display_order: 6,
    mapping: [
      { key: 'today', source_type: 'fixed', source_field: 'today' },
      { key: 'representative_title', source_type: 'tenant', source_field: 'representative_title' },
      { key: 'representative_name', source_type: 'tenant', source_field: 'representative_name' },
      { key: 'representative_honorific', source_type: 'tenant', source_field: 'representative_honorific' },
      { key: 'last_name_kana', source_type: 'employee', source_field: 'last_name_kana' },
      { key: 'first_name_kana', source_type: 'employee', source_field: 'first_name_kana' },
      { key: 'department', source_type: 'employee', source_field: 'department' },
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
      { key: 'join_date', source_type: 'employee', source_field: 'join_date' },
      { key: 'application_reason', source_type: 'form_data', source_field: 'application_reason', label: '申請理由', input_type: 'textarea', required: true },
      { key: 'accident_history', source_type: 'employee', source_field: 'accident_history' },
      { key: 'driving_experience', source_type: 'employee', source_field: 'driving_experience' },
      { key: 'training_attendance', source_type: 'employee', source_field: 'training_attendance' },
      { key: 'violation_remarks', source_type: 'form_data', source_field: 'violation_remarks', label: '違反備考', input_type: 'textarea', required: false },
    ],
  },
  {
    file: '10-自家用車両通勤申請書.docx',
    storageName: '10-jikayou-sharyo-tsuukin.docx',
    name: '自家用車両通勤申請書',
    visibility_condition: 'car_commute_only',
    display_order: 7,
    mapping: [
      { key: 'today', source_type: 'fixed', source_field: 'today' },
      { key: 'last_name_kana', source_type: 'employee', source_field: 'last_name_kana' },
      { key: 'first_name_kana', source_type: 'employee', source_field: 'first_name_kana' },
      { key: 'work_location', source_type: 'employee', source_field: 'work_location' },
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
      { key: 'application_start_date', source_type: 'form_data', source_field: 'application_start_date', label: '申請開始日', input_type: 'date', required: true },
      { key: 'application_reason', source_type: 'form_data', source_field: 'application_reason', label: '申請理由', input_type: 'textarea', required: true },
      { key: 'car_model', source_type: 'employee', source_field: 'car_model' },
      { key: 'car_plate_number', source_type: 'employee', source_field: 'car_plate_number' },
      { key: 'license_type', source_type: 'employee', source_field: 'license_type' },
      { key: 'license_number', source_type: 'employee', source_field: 'license_number' },
      { key: 'insurance_expiry', source_type: 'employee', source_field: 'insurance_expiry' },
      { key: 'insurance_policy_number', source_type: 'employee', source_field: 'insurance_policy_number' },
      { key: 'insurance_company', source_type: 'employee', source_field: 'insurance_company' },
      { key: 'commute_distance', source_type: 'employee', source_field: 'commute_distance' },
      { key: 'postal_code', source_type: 'employee', source_field: 'postal_code' },
      { key: 'address', source_type: 'employee', source_field: 'address' },
    ],
  },
  {
    file: '労働者名簿原本.docx',
    storageName: '09-roudousha-meibo.docx',
    name: '労働者名簿',
    visibility_condition: 'all',
    display_order: 8,
    mapping: [
      { key: 'last_name_kana', source_type: 'employee', source_field: 'last_name_kana' },
      { key: 'first_name_kana', source_type: 'employee', source_field: 'first_name_kana' },
      { key: 'employee_number', source_type: 'employee', source_field: 'employee_number' },
      { key: 'last_name', source_type: 'employee', source_field: 'last_name' },
      { key: 'first_name', source_type: 'employee', source_field: 'first_name' },
      { key: 'birth_date', source_type: 'employee', source_field: 'birth_date' },
      { key: 'postal_code', source_type: 'employee', source_field: 'postal_code' },
      { key: 'address', source_type: 'employee', source_field: 'address' },
      { key: 'phone', source_type: 'employee', source_field: 'phone' },
      { key: 'join_date', source_type: 'employee', source_field: 'join_date' },
      { key: 'department', source_type: 'employee', source_field: 'department' },
      { key: 'my_number', source_type: 'employee', source_field: 'my_number' },
      { key: 'bank_name', source_type: 'tenant', source_field: 'bank_name' },
      { key: 'branch_name', source_type: 'form_data', source_field: 'branch_name', label: '支店名', input_type: 'text', required: false },
      { key: 'account_number', source_type: 'form_data', source_field: 'account_number', label: '口座番号', input_type: 'text', required: false },
      { key: 'previous_employer', source_type: 'employee', source_field: 'previous_employer' },
      { key: 'qualifications', source_type: 'employee', source_field: 'qualifications' },
      { key: 'email', source_type: 'employee', source_field: 'email' },
    ],
  },
];

// ---------- 実行 ----------

async function main() {
  console.log('🚀 サンプル書類 seed 開始...\n');

  // 既存サンプルをクリア
  const { error: delErr } = await supabase
    .from('document_templates')
    .delete()
    .is('tenant_id', null)
    .eq('is_sample', true);

  if (delErr) {
    console.error('❌ 既存サンプル削除エラー:', delErr.message);
    process.exit(1);
  }
  console.log('🗑️  既存サンプルをクリア');

  for (const sample of samples) {
    const filePath = path.join('seed', 'sample-documents', sample.file);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  ファイル未検出: ${sample.file} — スキップ`);
      continue;
    }

    // Storage にアップロード（日本語ファイル名はNG → ASCII名で保存）
    const storagePath = `samples/${sample.storageName}`;
    const fileBuffer = fs.readFileSync(filePath);

    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });

    if (uploadErr) {
      console.warn(`⚠️  Storage アップロードエラー (${sample.file}): ${uploadErr.message}`);
    } else {
      console.log(`📦 Storage アップロード: ${storagePath}`);
    }

    // DB に登録
    const { error: insertErr } = await supabase
      .from('document_templates')
      .insert({
        tenant_id: null,
        name: sample.name,
        docx_storage_path: storagePath,
        mapping: sample.mapping,
        visibility_condition: sample.visibility_condition,
        is_sample: true,
        display_order: sample.display_order,
      });

    if (insertErr) {
      console.error(`❌ DB登録エラー (${sample.name}): ${insertErr.message}`);
    } else {
      console.log(`✅ 登録: ${sample.name} (${sample.mapping.length} フィールド)`);
    }
  }

  console.log('\n🎉 seed 完了！');
}

main().catch(console.error);
