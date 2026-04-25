import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resend, FROM_EMAIL } from '@/lib/resend';

const RESULT_LABELS: Record<string, string> = {
  passed: '合格',
  failed: '不合格',
  resubmit: '再提出',
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // admin または manager のみ
  const { data: me } = await supabase
    .from('employees')
    .select('role, tenant_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!me || (me.role !== 'admin' && me.role !== 'manager')) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const body = await request.json();
  const { employeeEmail, employeeName, trainingTitle, result, comment } = body as {
    employeeEmail: string;
    employeeName: string;
    trainingTitle: string;
    result: string;
    comment?: string;
  };

  if (!employeeEmail || !trainingTitle || !result) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name')
    .eq('id', me.tenant_id)
    .single();

  const company = tenant?.company_name || '';
  const resultLabel = RESULT_LABELS[result] || result;

  const resultColor = result === 'passed' ? '#22c55e' : result === 'failed' ? '#ef4444' : '#3b82f6';

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: employeeEmail,
    subject: `【${company}】研修「${trainingTitle}」の判定結果`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">${company}</h2>
        <p>${employeeName || ''}さん</p>
        <p>研修「<strong>${trainingTitle}</strong>」の判定結果をお知らせします。</p>
        <div style="margin: 24px 0; padding: 16px; background-color: #f8f8f8; border-radius: 8px; border-left: 4px solid ${resultColor};">
          <p style="margin: 0; font-size: 18px; font-weight: bold; color: ${resultColor};">
            ${resultLabel}
          </p>
          ${comment ? `<p style="margin: 8px 0 0; color: #666;">${comment}</p>` : ''}
        </div>
        ${result === 'resubmit' ? '<p>staffbase にログインして再提出してください。</p>' : ''}
        <p style="margin: 24px 0;">
          <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/my/dashboard"
             style="display: inline-block; background-color: #4169e1; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            staffbase を開く
          </a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 11px;">diletto by AI Skill Exchange — staffbase</p>
      </div>
    `,
  });

  if (error) {
    return NextResponse.json({ error: 'メール送信に失敗しました', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
