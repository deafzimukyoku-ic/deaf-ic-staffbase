import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * /api/employees/[id]/status
 *
 * 職員の在職 / 退職ステータスを切り替える。
 *
 * 重要な制約:
 *   - 呼び出せるのは admin のみ（manager / employee は不可）
 *   - 同テナントの社員のみ操作可
 *   - retire 時:
 *       - employees.status='retired', retirement_date, retirement_reason を更新
 *       - auth.users を BAN（876000h ≒ 100年）してログインを Supabase Auth レベルで遮断
 *   - reactivate 時:
 *       - employees.status='active', retirement_date=null, retirement_reason=null
 *       - auth.users の BAN を解除（ban_duration='none'）
 *   - 自分自身を退職にすることは禁止（操作不能になるため）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetEmployeeId } = await params;

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
    return NextResponse.json(
      { error: '在職/退職の切り替えは管理者のみ実行できます' },
      { status: 403 }
    );
  }

  const body = (await request.json()) as {
    action?: 'retire' | 'reactivate';
    retirement_date?: string;
    retirement_reason?: string | null;
  };

  if (body.action !== 'retire' && body.action !== 'reactivate') {
    return NextResponse.json({ error: 'action が不正です' }, { status: 400 });
  }

  const adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: target, error: targetErr } = await adminClient
    .from('employees')
    .select('id, tenant_id, auth_user_id, status')
    .eq('id', targetEmployeeId)
    .maybeSingle();

  if (targetErr || !target) {
    return NextResponse.json({ error: '対象職員が見つかりません' }, { status: 404 });
  }
  if (target.tenant_id !== me.tenant_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  if (target.id === me.id && body.action === 'retire') {
    return NextResponse.json(
      { error: '自分自身を退職にすることはできません' },
      { status: 400 }
    );
  }

  if (body.action === 'retire') {
    const retireDate = body.retirement_date?.trim();
    if (!retireDate || !/^\d{4}-\d{2}-\d{2}$/.test(retireDate)) {
      return NextResponse.json(
        { error: '退職日が不正です（YYYY-MM-DD）' },
        { status: 400 }
      );
    }

    const { error: empErr } = await adminClient
      .from('employees')
      .update({
        status: 'retired',
        retirement_date: retireDate,
        retirement_reason: body.retirement_reason?.trim() || null,
      })
      .eq('id', targetEmployeeId);

    if (empErr) {
      return NextResponse.json(
        { error: '退職処理に失敗しました', detail: empErr.message },
        { status: 500 }
      );
    }

    /* auth.users を BAN: 退職者はログインも既存セッションの refresh も不可になる。
       auth_user_id 未紐付け（招待前など）の社員は ban 対象なし。 */
    if (target.auth_user_id) {
      const { error: banErr } = await adminClient.auth.admin.updateUserById(
        target.auth_user_id,
        { ban_duration: '876000h' },
      );
      if (banErr) {
        /* employees の更新は成功しているので、Auth ban 失敗は警告で返す。
           middleware 側の retired チェックでログインは弾かれるため、機能上の穴は塞がる。 */
        return NextResponse.json({
          success: true,
          warning: 'Auth ユーザーの BAN に失敗しました。middleware で遮断されますが、Supabase 側で手動 ban を推奨',
          detail: banErr.message,
        });
      }
    }

    return NextResponse.json({ success: true });
  }

  /* action === 'reactivate' */
  const { error: empErr } = await adminClient
    .from('employees')
    .update({
      status: 'active',
      retirement_date: null,
      retirement_reason: null,
    })
    .eq('id', targetEmployeeId);

  if (empErr) {
    return NextResponse.json(
      { error: '在職への切り替えに失敗しました', detail: empErr.message },
      { status: 500 }
    );
  }

  if (target.auth_user_id) {
    const { error: unbanErr } = await adminClient.auth.admin.updateUserById(
      target.auth_user_id,
      { ban_duration: 'none' },
    );
    if (unbanErr) {
      return NextResponse.json({
        success: true,
        warning: 'Auth ユーザーの BAN 解除に失敗しました。Supabase 側で手動解除が必要かもしれません',
        detail: unbanErr.message,
      });
    }
  }

  return NextResponse.json({ success: true });
}
