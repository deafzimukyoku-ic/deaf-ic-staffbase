/**
 * テスト用マネージャーアカウント作成スクリプト
 *
 * 実行: npx tsx seed/seed-test-manager.ts
 *
 * 前提:
 *   - .env.local に NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY を設定済み
 *   - facilities にパズル / パレット / パステルが存在
 *
 * 作成されるアカウント:
 *   - email: test-manager@example.com
 *   - password: 12345678
 *   - role: manager
 *   - 担当事業所: パズル（自分の所属）+ パレット + パステル
 *
 * 再実行時の挙動:
 *   - 既に同 email の auth ユーザーがあれば再利用
 *   - employees 行が無ければ作成、あれば role=manager に更新
 *   - manager_facilities は upsert（重複しても安全）
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = 'test-manager@example.com';
const PASSWORD = '12345678';
const FACILITY_NAMES = ['パズル', 'パレット', 'パステル'];
const PRIMARY_FACILITY_NAME = 'パズル'; // employees.facility_id に入れる

const PROFILE = {
  last_name: 'テスト',
  first_name: 'マネージャー',
  last_name_kana: 'テスト',
  first_name_kana: 'マネージャー',
  employee_number: 'X-MGR-001',
  /* DB は NOT NULL のカラムが多いのでダミー値を埋める */
  birth_date: '1990-01-01',
  postal_code: '460-0008',
  address: '愛知県名古屋市中区栄三丁目1-1',
  phone: '090-0000-0000',
  join_date: new Date().toISOString().slice(0, 10),
};

async function main() {
  console.log('🔍 tenant 取得中...');
  const { data: tenants, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, company_name')
    .limit(1);
  if (tenantErr) throw tenantErr;
  if (!tenants || tenants.length === 0) {
    console.error('❌ tenants が空です。先に NPO 本部を登録してください。');
    process.exit(1);
  }
  const tenant = tenants[0];
  console.log(`  ✓ tenant: ${tenant.company_name} (${tenant.id})`);

  console.log('🔍 facilities 取得中...');
  /* 施設名は前後に絵文字 prefix が付いているケースがあるので部分一致で引く（"🧩 パズル" 等） */
  const facilities: { id: string; name: string }[] = [];
  for (const facName of FACILITY_NAMES) {
    const { data: matched, error } = await supabase
      .from('facilities')
      .select('id, name')
      .eq('tenant_id', tenant.id)
      .like('name', `%${facName}%`)
      .limit(1);
    if (error) throw error;
    if (!matched || matched.length === 0) {
      console.error(`❌ 施設「${facName}」が見つかりません`);
      process.exit(1);
    }
    facilities.push(matched[0]);
    console.log(`  ✓ ${matched[0].name} (${matched[0].id})`);
  }

  const primaryFacility = facilities.find((f) => f.name.includes(PRIMARY_FACILITY_NAME));
  if (!primaryFacility) {
    console.error(`❌ プライマリ施設「${PRIMARY_FACILITY_NAME}」が見つかりません`);
    process.exit(1);
  }

  console.log(`👤 auth ユーザー作成 (${EMAIL})...`);
  let authUserId: string | null = null;
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createErr) {
    if (createErr.message?.includes('already')) {
      /* 既存ユーザー: メールから ID を引き戻す */
      const { data: list } = await supabase.auth.admin.listUsers();
      const existing = list?.users?.find((u) => u.email === EMAIL);
      if (!existing) throw new Error(`既存のはずだが listUsers で見つからない: ${EMAIL}`);
      authUserId = existing.id;
      console.log(`  ✓ 既存 auth ユーザーを再利用: ${authUserId}`);
      /* パスワード初期化（再実行で 12345678 に揃える） */
      await supabase.auth.admin.updateUserById(authUserId, { password: PASSWORD });
      console.log(`  ✓ パスワードを ${PASSWORD} に初期化`);
    } else {
      throw createErr;
    }
  } else {
    authUserId = created.user.id;
    console.log(`  ✓ 新規作成: ${authUserId}`);
  }

  if (!authUserId) {
    console.error('❌ auth_user_id 取得失敗');
    process.exit(1);
  }

  console.log('📋 employees 行 upsert...');
  /* email + tenant_id で既存判定（auth_user_id 違いの孤児を作らない） */
  const { data: existingEmp } = await supabase
    .from('employees')
    .select('id')
    .eq('email', EMAIL)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  let employeeId: string;
  const empPayload = {
    tenant_id: tenant.id,
    auth_user_id: authUserId,
    email: EMAIL,
    role: 'manager' as const,
    status: 'active',
    facility_id: primaryFacility.id,
    ...PROFILE,
  };

  if (existingEmp) {
    employeeId = existingEmp.id;
    const { error: updErr } = await supabase
      .from('employees')
      .update(empPayload)
      .eq('id', existingEmp.id);
    if (updErr) throw updErr;
    console.log(`  ✓ 既存 employee 更新: ${employeeId}`);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('employees')
      .insert(empPayload)
      .select('id')
      .single();
    if (insErr) throw insErr;
    employeeId = inserted.id;
    console.log(`  ✓ 新規 employee 作成: ${employeeId}`);
  }

  console.log('🏢 manager_facilities 紐付け...');
  /* 自分の facility_id は migration 046 で自動的に管轄に含まれるので、
     残り 2 施設だけ manager_facilities に明示登録する。
     ただし全 3 施設を入れても複合 PK なので冪等。 */
  for (const fac of facilities) {
    if (fac.id === primaryFacility.id) continue;
    const { error: mfErr } = await supabase
      .from('manager_facilities')
      .upsert({ employee_id: employeeId, facility_id: fac.id }, { onConflict: 'employee_id,facility_id' });
    if (mfErr) throw mfErr;
    console.log(`  ✓ ${fac.name}`);
  }

  console.log('\n✅ 完了');
  console.log('─────────────────────────────────────');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  Role:     manager`);
  console.log(`  所属:     ${primaryFacility.name}`);
  console.log(`  担当:     ${facilities.map((f) => f.name).join(' / ')}`);
  console.log('─────────────────────────────────────');
  console.log('ログインして /mgr/dashboard にアクセスできるか確認してください。');
}

main().catch((err) => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
