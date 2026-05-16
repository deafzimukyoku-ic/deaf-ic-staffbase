import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { brandedInviteHtml } from '@/lib/email/invite-html';

/**
 * POST: 社員への招待メール再送信
 * body: { employee_id: string }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('role, tenant_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!me || (me.role !== 'admin')) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const { employee_id } = await request.json() as { employee_id: string };

  if (!employee_id) {
    return NextResponse.json({ error: 'employee_id が必要です' }, { status: 400 });
  }

  // 対象社員を取得（同一テナントであることを確認）
  const { data: emp } = await supabase
    .from('employees')
    .select('id, email, last_name, first_name, auth_user_id, tenant_id')
    .eq('id', employee_id)
    .eq('tenant_id', me.tenant_id)
    .single();

  if (!emp) {
    return NextResponse.json({ error: '社員が見つかりません' }, { status: 404 });
  }

  const adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Recovery link生成（PKCE方式: /auth/callback 経由でセッション確立）
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4003';
  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email: emp.email,
    options: { redirectTo: `${siteUrl}/invite/accept` },
  });

  if (linkErr || !linkData) {
    return NextResponse.json(
      { error: '招待リンクの生成に失敗しました', detail: linkErr?.message },
      { status: 500 },
    );
  }

  const inviteLink = linkData.properties.action_link;

  // テナント名取得
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name')
    .eq('id', me.tenant_id)
    .single();

  const company = tenant?.company_name || '';
  const employeeName = `${emp.last_name} ${emp.first_name}`;

  // メール送信（NPO ブランド HTML / lib/email/invite-html.ts と統一）
  const { error: mailErr } = await resend.emails.send({
    from: FROM_EMAIL,
    to: emp.email,
    subject: `【${company}】職員ステーションへの招待（再送信）`,
    html: brandedInviteHtml({ company, employeeName, inviteLink, isResend: true }),
  });

  if (mailErr) {
    /* Resend daily limit 等で送信失敗。URL は既に generateLink で取得済みなので
       UI に返して手動配布に切替てもらう。invited_at は「メール送れた時だけ更新」だと
       手動配布フローで永久に未送信扱いになるので、リンク発行をもって更新する。 */
    await supabase
      .from('employees')
      .update({ invited_at: new Date().toISOString() })
      .eq('id', employee_id);

    return NextResponse.json({
      success: true,
      warning: '招待メールの送信に失敗しました。下記 URL を別チャネルで 1 時間以内に共有してください。',
      inviteLink,
      detail: String(mailErr),
    });
  }

  // invited_at を更新
  await supabase
    .from('employees')
    .update({ invited_at: new Date().toISOString() })
    .eq('id', employee_id);

  return NextResponse.json({ success: true });
}
