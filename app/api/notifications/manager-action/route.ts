import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { sendWebPushToEmployees } from '@/lib/push/server';

export async function POST(req: NextRequest) {
    // 1. 認証チェック (呼び出し元がログインしているか)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    // 2. リクエストデータの取得
    const body = await req.json();
    const { tenant_id, manager_name, action_type, action_details } = body;

    if (!tenant_id || !manager_name || !action_type) {
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    // 3. Service Role クライアントで管理者リストを取得 (RLSバイパス)
    const adminClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: admins } = await adminClient
        .from('employees')
        .select('id, email')
        .eq('tenant_id', tenant_id)
        .in('role', ['admin'])
        .eq('status', 'active')
        .not('email', 'is', null);

    if (!admins || admins.length === 0) {
        return NextResponse.json({ ok: true, message: 'No active admins found for this tenant' });
    }

    const emails = admins.map(a => a.email!);
    const adminIds = admins.map(a => a.id as string);

    // 4. テナント情報の取得
    const { data: tenant } = await adminClient
        .from('tenants')
        .select('company_name')
        .eq('id', tenant_id)
        .single();

    const company = tenant?.company_name || 'staffbase';
    const subject = `【${company}】マネージャー操作通知: ${action_type}`;

    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="background-color: #1a1a2e; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px;">${company}</h1>
      </div>
      <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <h2 style="color: #1f2937; margin-top: 0; font-size: 18px; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px;">マネージャー操作通知</h2>
        <p style="margin: 20px 0; line-height: 1.6;">以下の重要な操作がマネージャーによって行われましたので、お知らせいたします。</p>
        
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <th style="text-align: left; padding: 8px 0; color: #6b7280; font-size: 13px; text-transform: uppercase; width: 100px;">操作者</th>
              <td style="padding: 8px 0; font-weight: bold; color: #111827;">${manager_name} さん</td>
            </tr>
            <tr>
              <th style="text-align: left; padding: 8px 0; color: #6b7280; font-size: 13px; text-transform: uppercase;">操作内容</th>
              <td style="padding: 8px 0; font-weight: bold; color: #111827;">${action_type}</td>
            </tr>
            <tr>
              <th style="text-align: left; padding: 8px 0; color: #6b7280; font-size: 13px; text-transform: uppercase; vertical-align: top;">詳細</th>
              <td style="padding: 8px 0; color: #374151; white-space: pre-wrap; line-height: 1.6;">${action_details}</td>
            </tr>
          </table>
        </div>
        
        <p style="color: #6b7280; font-size: 12px; margin-top: 30px; text-align: center;">
          本件に関して通知が必要ない場合は、システム設定をご確認ください。<br>
          © diletto StaffBase
        </p>
      </div>
    </div>
  `;

    // 5. メール送信 + Web Push 並行配信
    try {
        const [emailRes] = await Promise.allSettled([
            resend.emails.send({
                from: FROM_EMAIL,
                to: emails,
                subject,
                html,
            }),
            sendWebPushToEmployees(adminClient, adminIds, {
                title: subject,
                body: `${manager_name} さん: ${action_type}`,
                url: '/admin/dashboard',
            }),
        ]);
        if (emailRes.status === 'rejected') throw emailRes.reason;
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[manager-action/notification] Email failed', err);
        return NextResponse.json({ error: 'Failed to send notification email' }, { status: 500 });
    }
}
