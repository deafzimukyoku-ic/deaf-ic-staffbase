/**
 * デモアカウント 1名 作成スクリプト (録画用、後で削除)
 *
 * 実行:  node scripts/create-demo-account.js
 * 削除:  node scripts/create-demo-account.js delete
 *
 * 作成内容:
 *   - auth.users 1名 (email: demo-recording@deafic.test / password: Demo2026!)
 *   - employees 1行 (既存の最初の事業所に所属、role='employee' で開始)
 *   - 後でロール変更 (employee → manager → admin → shift_manager) で全シナリオ撮影
 *   - employee_number に 'DEMO-' プレフィックスを付けて識別可能に
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が見つかりません');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const DEMO_EMAIL = 'demo-recording@deafic.test';
const DEMO_PASSWORD = 'Demo2026!';
const DEMO_MARKER = 'DEMO-RECORDING'; // employee_number prefix で識別

async function listFacilities() {
  const { data: facilities, error } = await sb.from('facilities').select('id, name, tenant_id').order('display_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
  if (error) throw error;
  return facilities;
}

async function createDemo() {
  console.log('=== デモアカウント作成 ===');

  // 1) 既存事業所一覧
  const facilities = await listFacilities();
  if (facilities.length === 0) {
    console.error('事業所が存在しません。先に事業所を作成してください。');
    process.exit(1);
  }
  console.log('既存事業所:');
  facilities.forEach((f, i) => console.log(`  ${i+1}. ${f.name}  (id=${f.id})`));
  const target = facilities[0];
  console.log(`  → ${target.name} に所属で作成します\n`);

  // 2) auth.users 作成
  const { data: u, error: uErr } = await sb.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { demo: true },
  });
  if (uErr) {
    if (uErr.message && uErr.message.includes('already')) {
      console.log('⚠ 既に同じ email のユーザーが存在します。delete 後に再実行してください。');
      console.log('   node scripts/create-demo-account.js delete');
      process.exit(1);
    }
    throw uErr;
  }
  console.log(`✓ auth.users 作成: ${u.user.id}  email=${DEMO_EMAIL}  password=${DEMO_PASSWORD}`);

  // 3) employees 1行
  const { data: e, error: eErr } = await sb.from('employees').insert({
    tenant_id: target.tenant_id,
    facility_id: target.id,
    auth_user_id: u.user.id,
    employee_number: `${DEMO_MARKER}-001`,
    email: DEMO_EMAIL,
    role: 'employee', // 録画中にロール変更
    status: 'active',
    last_name: '山田',
    first_name: '太郎',
    last_name_kana: 'ヤマダ',
    first_name_kana: 'タロウ',
    birth_date: '1990-01-01',
    postal_code: '460-0000',
    address: '愛知県名古屋市中区錦三丁目1-1',
    phone: '052-000-0000',
    join_date: '2026-01-01',
    has_car_commute: false,
    is_shuttle_driver: false,
  }).select().single();
  if (eErr) {
    // ロールバック
    await sb.auth.admin.deleteUser(u.user.id);
    throw eErr;
  }
  console.log(`✓ employees 作成: ${e.id}  ${e.last_name} ${e.first_name}  role=${e.role}  事業所=${target.name}`);

  console.log('\n=== 完了 ===');
  console.log(`email:    ${DEMO_EMAIL}`);
  console.log(`password: ${DEMO_PASSWORD}`);
  console.log(`employee: ${e.id}`);
  console.log('\n録画シナリオ進行中にロール変更したい時:');
  console.log(`  /admin/access-matrix で「${e.last_name} ${e.first_name}」を employee/manager/admin/shift_manager に切替`);
  console.log('\n削除コマンド:');
  console.log('  node scripts/create-demo-account.js delete');
}

async function deleteDemo() {
  console.log('=== デモアカウント削除 ===');
  // 1) employees 行を削除 (employee_number で識別)
  const { data: emps, error: e1 } = await sb.from('employees').select('id, auth_user_id, last_name, first_name').like('employee_number', `${DEMO_MARKER}%`);
  if (e1) throw e1;
  if (emps.length === 0) {
    console.log('該当のデモアカウントは見つかりませんでした');
    return;
  }
  for (const emp of emps) {
    console.log(`削除: ${emp.last_name} ${emp.first_name}  (${emp.id})`);
    await sb.from('employees').delete().eq('id', emp.id);
    if (emp.auth_user_id) await sb.auth.admin.deleteUser(emp.auth_user_id);
  }
  console.log('✓ 完了');
}

const cmd = process.argv[2];
(cmd === 'delete' ? deleteDemo() : createDemo()).catch(err => {
  console.error('エラー:', err.message || err);
  process.exit(1);
});
