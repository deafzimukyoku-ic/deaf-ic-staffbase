import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * /api/employees/[id]/email
 *
 * 職員のメールアドレスを変更する。
 *
 * 重要な制約:
 *   - 呼び出せるのは admin のみ（manager / employee は不可）
 *   - 対象が status='retired' なら拒否（退職者の email は履歴として固定）
 *   - auth.users.email と employees.email を **両方** 更新して乖離を防ぐ
 *     → 旧 email でログインできなくなる事故を防止
 *   - migration 132 のトリガが service_role 以外の email 直接更新を block するため、
 *     admin が UI から直接 employees.email を書き換える経路を遮断し、必ずこの API を経由させる
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetEmployeeId } = await params;

  // 1. 認証 + admin 権限チェック
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('id, role, tenant_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'メールアドレス変更は管理者のみ実行できます' }, { status: 403 });
  }

  // 2. リクエスト body
  const body = (await request.json()) as { email?: string };
  const newEmailRaw = body.email?.trim() ?? '';
  if (!newEmailRaw) {
    return NextResponse.json({ error: 'メールアドレスを入力してください' }, { status: 400 });
  }
  // 簡易フォーマット検証（RFC 完全準拠ではないが NPO 用途には十分）
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmailRaw)) {
    return NextResponse.json({ error: 'メールアドレスの形式が正しくありません' }, { status: 400 });
  }
  const newEmail = newEmailRaw.toLowerCase();

  // 3. service_role クライアント（RLS バイパス + auth admin 操作用）
  const adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 4. 対象職員の取得 + バリデーション
  const { data: target, error: targetErr } = await adminClient
    .from('employees')
    .select('id, tenant_id, auth_user_id, email, status, last_name, first_name')
    .eq('id', targetEmployeeId)
    .maybeSingle();

  if (targetErr || !target) {
    return NextResponse.json({ error: '対象職員が見つかりません' }, { status: 404 });
  }
  if (target.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  if (target.status === 'retired') {
    return NextResponse.json(
      { error: '退職者のメールアドレスは変更できません' },
      { status: 400 }
    );
  }
  if (!target.auth_user_id) {
    return NextResponse.json(
      { error: 'この職員はまだ Auth ユーザーが紐付いていません（招待前？）' },
      { status: 400 }
    );
  }
  if (target.email?.toLowerCase() === newEmail) {
    return NextResponse.json({ success: true, unchanged: true });
  }

  // 5. 同テナント内で email 重複チェック
  const { data: dup } = await adminClient
    .from('employees')
    .select('id')
    .eq('tenant_id', me.tenant_id)
    .eq('email', newEmail)
    .neq('id', targetEmployeeId)
    .maybeSingle();
  if (dup) {
    return NextResponse.json(
      { error: '同じメールアドレスの職員が既に存在します' },
      { status: 409 }
    );
  }

  // 6. auth.users.email を先に更新（こちらが canonical なログイン情報）
  const { error: authUpdateErr } = await adminClient.auth.admin.updateUserById(
    target.auth_user_id,
    {
      email: newEmail,
      email_confirm: true,
    }
  );
  if (authUpdateErr) {
    return NextResponse.json(
      { error: 'Auth ユーザーの更新に失敗しました', detail: authUpdateErr.message },
      { status: 500 }
    );
  }

  // 7. employees.email を更新（migration 132 のトリガを service_role で通過）
  const { error: empUpdateErr } = await adminClient
    .from('employees')
    .update({ email: newEmail })
    .eq('id', targetEmployeeId);
  if (empUpdateErr) {
    /* auth.users は更新済 → ここで失敗すると DB 上で乖離する。
       次回ログインは新 email で動くが、社員レコードは古い email を保持する。
       警告レスポンスして手動修正を促す。 */
    return NextResponse.json(
      {
        error: 'auth.users は更新したが employees の更新に失敗しました。手動で修正してください',
        detail: empUpdateErr.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, email: newEmail });
}
