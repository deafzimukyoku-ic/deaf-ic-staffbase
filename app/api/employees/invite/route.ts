import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { brandedInviteHtml } from '@/lib/email/invite-html';

export async function POST(request: NextRequest) {
  // 1. 認証チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('role, tenant_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || (me.role !== 'admin')) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  // リクエストボディ
  const body = await request.json();
  const {
    email,
    employee_number,
    last_name,
    first_name,
    last_name_kana,
    first_name_kana,
    join_date,
    has_car_commute,
    is_shuttle_driver,
    facility_id,
    position_id,
    role: requestedRole,
    manager_facility_ids,
  } = body as {
    email: string;
    employee_number: string;
    last_name: string;
    first_name: string;
    last_name_kana: string;
    first_name_kana: string;
    join_date: string;
    has_car_commute: boolean;
    is_shuttle_driver: boolean;
    facility_id: string | null;
    /** positions テーブルの id。employees には text の `position` カラムしか無いため、ここから name を引いて保存する。 */
    position_id?: string | null;
    role?: 'admin' | 'manager' | 'shift_manager' | 'employee';
    /** 担当施設の追加 (manager_facilities)。manager の場合のみ意味を持つ。 */
    manager_facility_ids?: string[];
  };
  /* 不正値ガード: 未指定/未知の値は employee に正規化。
     migration 140: shift_manager は事業所共用 → facility_id 必須。 */
  const normalizedRole: 'admin' | 'manager' | 'shift_manager' | 'employee' =
    requestedRole === 'admin' || requestedRole === 'manager' || requestedRole === 'shift_manager'
      ? requestedRole
      : 'employee';
  if (normalizedRole === 'shift_manager' && !facility_id) {
    return NextResponse.json(
      { error: 'シフト統括アカウントには所属事業所 (facility_id) が必須です' },
      { status: 400 }
    );
  }

  if (!email || !employee_number || !last_name || !first_name) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }

  // 2. Service Role クライアントでAuthユーザー作成
  const adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // position_id 指定がある場合は positions から name を引いて employees.position (text) に保存する。
  // 同テナントでない id を弾く意味でも tenant_id 条件付きで取得。
  let positionName = '';
  if (position_id) {
    const { data: pos } = await adminClient
      .from('positions')
      .select('name')
      .eq('id', position_id)
      .eq('tenant_id', me.tenant_id)
      .maybeSingle();
    positionName = pos?.name ?? '';
  }

  // 既存employeeチェック（同じテナント+メールアドレス）
  const { data: existingEmp } = await adminClient
    .from('employees')
    .select('id, auth_user_id')
    .eq('tenant_id', me.tenant_id)
    .eq('email', email)
    .maybeSingle();

  if (existingEmp) {
    // 既に社員レコードがある → 招待メールだけ再送信
    return await resendInviteOnly({
      adminClient,
      supabase,
      authUserId: existingEmp.auth_user_id,
      tenantId: me.tenant_id,
      email,
      employeeName: `${last_name} ${first_name}`,
    });
  }

  const { data: authUser, error: createUserErr } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  let authUserId: string;
  // 今回このリクエストで新規作成した auth.users かどうか。
  // 失敗時のロールバック対象を絞るために使う（既存ユーザーは消してはいけない）。
  let createdNewAuthUser = false;

  if (createUserErr) {
    if (createUserErr.message?.includes('already been registered')) {
      // Authユーザーは存在するがemployeeレコードがない場合
      const { data: existingUsers } = await adminClient.auth.admin.listUsers();
      const existing = existingUsers?.users?.find((u) => u.email === email);
      if (!existing) {
        return NextResponse.json(
          { error: 'ユーザー作成に失敗しました', detail: createUserErr.message },
          { status: 500 },
        );
      }
      authUserId = existing.id;
    } else {
      return NextResponse.json(
        { error: 'ユーザー作成に失敗しました', detail: createUserErr.message },
        { status: 500 },
      );
    }
  } else {
    authUserId = authUser.user.id;
    createdNewAuthUser = true;
  }

  // 3. employeeレコード作成 + 招待メール送信
  return await createEmployeeAndSendInvite({
    adminClient,
    supabase,
    authUserId,
    createdNewAuthUser,
    tenantId: me.tenant_id,
    employeeData: { email, employee_number, last_name, first_name, last_name_kana, first_name_kana, join_date, has_car_commute, is_shuttle_driver, facility_id, position: positionName, role: normalizedRole, manager_facility_ids: manager_facility_ids ?? [] },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceRoleClient = ReturnType<typeof createSupabaseClient<any>>;

/* ── 招待メール再送信（employeeレコード既存の場合） ── */
async function resendInviteOnly({
  adminClient,
  supabase,
  authUserId,
  tenantId,
  email,
  employeeName,
}: {
  adminClient: ServiceRoleClient;
  supabase: Awaited<ReturnType<typeof createClient>>;
  authUserId: string;
  tenantId: string;
  email: string;
  employeeName: string;
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4003';

  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${siteUrl}/invite/accept` },
  });

  if (linkErr || !linkData) {
    return NextResponse.json(
      { error: 'リカバリーリンクの生成に失敗しました', detail: linkErr?.message },
      { status: 500 },
    );
  }

  const inviteLink = linkData.properties.action_link;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name')
    .eq('id', tenantId)
    .single();

  const company = tenant?.company_name || '';

  const { error: mailErr } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `【${company}】職員ステーションへの招待（再送信）`,
    html: brandedInviteHtml({
      company,
      employeeName,
      inviteLink,
      isResend: true,
    }),
  });

  if (mailErr) {
    return NextResponse.json({
      success: true,
      warning: 'この社員は既に登録済みですが、招待メールの再送信に失敗しました',
    });
  }

  return NextResponse.json({
    success: true,
    resent: true,
    message: 'この社員は既に登録済みのため、招待メールを再送信しました',
  });
}

interface CreateParams {
  adminClient: ServiceRoleClient;
  supabase: Awaited<ReturnType<typeof createClient>>;
  authUserId: string;
  /** このリクエストで新規作成した auth.users かどうか（rollback 対象判定）。 */
  createdNewAuthUser: boolean;
  tenantId: string;
  employeeData: {
    email: string;
    employee_number: string;
    last_name: string;
    first_name: string;
    last_name_kana: string;
    first_name_kana: string;
    join_date: string;
    has_car_commute: boolean;
    is_shuttle_driver: boolean;
    facility_id: string | null;
    position: string;
    role: 'admin' | 'manager' | 'shift_manager' | 'employee';
    manager_facility_ids: string[];
  };
}

async function createEmployeeAndSendInvite({
  adminClient,
  supabase,
  authUserId,
  createdNewAuthUser,
  tenantId,
  employeeData,
}: CreateParams) {
  const { email, employee_number, last_name, first_name, last_name_kana, first_name_kana, join_date, has_car_commute, is_shuttle_driver, facility_id, position, role, manager_facility_ids } = employeeData;

  // employeeレコード作成（service roleでRLSバイパス）
  const { data: createdEmp, error: empErr } = await adminClient
    .from('employees')
    .insert({
      tenant_id: tenantId,
      auth_user_id: authUserId,
      employee_number,
      email,
      role,
      last_name,
      first_name,
      last_name_kana,
      first_name_kana,
      birth_date: '2000-01-01',
      postal_code: '',
      address: '',
      phone: '',
      join_date,
      has_car_commute,
      is_shuttle_driver,
      facility_id: facility_id || null,
      position: position || '',
      invited_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (empErr || !createdEmp) {
    /* employees insert に失敗した場合、今回新規作成した auth.users を rollback で削除する。
       既存 auth.users（別経路で作られていたユーザー）を再利用したケースは消さない。 */
    if (createdNewAuthUser) {
      const { error: delErr } = await adminClient.auth.admin.deleteUser(authUserId);
      if (delErr) {
        // rollback 失敗は致命ではないがログには残す（運用で見つけて手動掃除する）
        console.error('rollback auth.admin.deleteUser failed:', delErr.message);
      }
    }
    return NextResponse.json(
      { error: '社員レコードの作成に失敗しました', detail: empErr?.message },
      { status: 500 },
    );
  }

  /* manager の場合、所属以外の担当施設を manager_facilities に bulk insert。
     所属施設 (facility_id) は重複登録しない。 */
  let managerFacilitiesWarning: string | null = null;
  if (role === 'manager' && manager_facility_ids.length > 0) {
    const rows = manager_facility_ids
      .filter((fid) => fid && fid !== facility_id)
      .map((fid) => ({ employee_id: createdEmp.id, facility_id: fid }));
    if (rows.length > 0) {
      const { error: mfErr } = await adminClient.from('manager_facilities').insert(rows);
      if (mfErr) {
        /* 招待自体は成功扱いにし、警告として返す（後から /admin/access-matrix で再設定可能） */
        console.error('manager_facilities insert failed:', mfErr.message);
        managerFacilitiesWarning = '招待は完了しましたが、追加担当施設の登録に失敗しました。アクセス権マトリクスから設定してください。';
      }
    }
  }

  // Recovery link生成（PKCE方式: code付きリダイレクト）
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4003';

  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${siteUrl}/invite/accept`,
    },
  });

  if (linkErr || !linkData) {
    return NextResponse.json(
      { error: 'リカバリーリンクの生成に失敗しました', detail: linkErr?.message },
      { status: 500 },
    );
  }

  // generateLinkが返すaction_linkを招待メールに使用
  const inviteLink = linkData.properties.action_link;

  // テナント名を取得
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name')
    .eq('id', tenantId)
    .single();

  const company = tenant?.company_name || '';
  const employeeName = `${last_name} ${first_name}`;

  // Resend で招待メール送信（NPO ブランド HTML / migration: lib/email/invite-html.ts）
  const { error: mailErr } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `【${company}】職員ステーションへの招待`,
    html: brandedInviteHtml({ company, employeeName, inviteLink, isResend: false }),
  });

  if (mailErr) {
    // メール送信失敗してもemployeeレコードは作成済み
    return NextResponse.json({
      success: true,
      warning: managerFacilitiesWarning
        ? `社員は作成されましたが、招待メールの送信に失敗しました。${managerFacilitiesWarning}`
        : '社員は作成されましたが、招待メールの送信に失敗しました',
    });
  }

  if (managerFacilitiesWarning) {
    return NextResponse.json({ success: true, warning: managerFacilitiesWarning });
  }

  return NextResponse.json({ success: true });
}
