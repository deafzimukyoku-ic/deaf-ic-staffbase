import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * /api/facilities/issue-shift-account
 *
 * 指定 facility に対して「シフト統括アカウント」を 1 個自動発行する。
 *  - email: shift-{facility_id_short}@deaf-ic-nagoya.org （ダミー、メール届かなくてもOK）
 *  - password: 自動生成 16 文字（英大小 + 数字 + 記号）
 *  - role: shift_manager (migration 140)
 *  - facility_id: 指定 facility に固定
 *
 * 発行直後にパスワードを 1 度だけレスポンスで返す。admin が UI 側で
 * モーダル表示 → コピーして事業所に伝達する想定。再表示不可（保存し直し or
 * 別途リセット API が必要、今は admin が同 API を呼べば再発行可能）。
 */

/* セキュリティ強度十分なパスワードを生成。
   英大小 + 数字 + 記号 4 種を必ず含む 16 文字。 */
function generateStrongPassword(length = 16): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz'; // l, o は除外
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I, O は除外
  const digits = '23456789'; // 0, 1 は除外
  const symbols = '!@#$%^&*';
  const all = lower + upper + digits + symbols;

  function pick(chars: string) {
    return chars[Math.floor(Math.random() * chars.length)];
  }

  /* 各種から 1 文字ずつ確実に含める */
  const required = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  /* 残りはランダム */
  const remaining: string[] = [];
  for (let i = 0; i < length - required.length; i++) {
    remaining.push(pick(all));
  }
  /* シャッフル */
  const arr = [...required, ...remaining];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

/* facility_id の先頭 8 文字で email のローカル部を作る */
function buildEmail(facilityId: string, baseDomain: string): string {
  const short = facilityId.replace(/-/g, '').slice(0, 8).toLowerCase();
  return `shift-${short}@${baseDomain}`;
}

export async function POST(request: NextRequest) {
  /* 1. 認証 + admin 権限チェック */
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('id, role, tenant_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'シフト統括の発行は管理者のみ実行できます' }, { status: 403 });
  }

  /* 2. facility 検証 */
  const body = await request.json() as { facility_id?: string };
  const facilityId = body.facility_id;
  if (!facilityId) {
    return NextResponse.json({ error: 'facility_id が必要です' }, { status: 400 });
  }

  const adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: facility, error: facErr } = await adminClient
    .from('facilities')
    .select('id, tenant_id, name')
    .eq('id', facilityId)
    .maybeSingle();
  if (facErr || !facility) {
    return NextResponse.json({ error: '事業所が見つかりません' }, { status: 404 });
  }
  if (facility.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  /* 3. 既存の shift_manager アカウントがあるか確認 */
  const { data: existing } = await adminClient
    .from('employees')
    .select('id, email')
    .eq('tenant_id', me.tenant_id)
    .eq('facility_id', facilityId)
    .eq('role', 'shift_manager')
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: 'この事業所にはすでにシフト統括アカウントが存在します',
        existingEmail: existing.email,
      },
      { status: 409 }
    );
  }

  /* 4. メール + パスワード自動生成 */
  const baseDomain = (process.env.NEXT_PUBLIC_SITE_URL || 'https://deaf-ic-nagoya.org')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const email = buildEmail(facilityId, baseDomain);
  const password = generateStrongPassword(16);

  /* 5. auth.users 作成 (email_confirm: true で確認メールスキップ) */
  const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !authUser?.user) {
    return NextResponse.json(
      { error: 'Auth ユーザーの作成に失敗しました', detail: authErr?.message },
      { status: 500 }
    );
  }

  /* 6. employees 行作成。事業所共用なので氏名はわかりやすくする */
  const { error: empErr } = await adminClient
    .from('employees')
    .insert({
      tenant_id: me.tenant_id,
      auth_user_id: authUser.user.id,
      employee_number: `SHIFT-${facility.id.slice(0, 4).toUpperCase()}`,
      email,
      role: 'shift_manager',
      facility_id: facilityId,
      last_name: facility.name,
      first_name: 'シフト統括',
      last_name_kana: '',
      first_name_kana: '',
      birth_date: '2000-01-01',
      postal_code: '',
      address: '',
      phone: '',
      join_date: new Date().toISOString().slice(0, 10),
      has_car_commute: false,
      is_shuttle_driver: false,
    });

  if (empErr) {
    /* employees insert 失敗 → auth.users を rollback */
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json(
      { error: '社員レコードの作成に失敗しました', detail: empErr.message },
      { status: 500 }
    );
  }

  /* 7. 発行完了。パスワードを 1 度だけ返却（再表示不可） */
  return NextResponse.json({
    success: true,
    email,
    password,
    facility_name: facility.name,
    message: 'シフト統括アカウントを発行しました。パスワードを必ずコピーして保管してください（再表示できません）。',
  });
}
