import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { buildReminderEmail, type ReminderCategory } from '@/lib/email/reminder-email';

const VALID_CATEGORIES: ReminderCategory[] = ['documents', 'compliance', 'training', 'announcements'];

// POST /api/admin/send-reminder
// Body: { category: ReminderCategory, employee_ids: string[] }
// admin のみ。service role で RLS bypass して送信
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: me } = await supabase
    .from('employees')
    .select('tenant_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (!['admin'].includes(me.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const body = await req.json();
  const category = body.category as ReminderCategory;
  const employeeIds = body.employee_ids as string[];

  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'category が不正です' }, { status: 400 });
  }
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    return NextResponse.json({ error: '送信対象が空です' }, { status: 400 });
  }

  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return NextResponse.json({ error: 'APP_URL 未設定' }, { status: 500 });

  // service roleで社員情報を取得（テナント境界は明示チェック）
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: employees } = await admin
    .from('employees')
    .select('id, last_name, first_name, email, tenant_id, status')
    .in('id', employeeIds)
    .eq('tenant_id', me.tenant_id) // 他テナントの社員を指定されても拒否
    .eq('status', 'active')
    .not('email', 'is', null);

  if (!employees || employees.length === 0) {
    return NextResponse.json({ error: '送信可能な社員がいません' }, { status: 400 });
  }

  const { data: tenant } = await admin
    .from('tenants')
    .select('company_name')
    .eq('id', me.tenant_id)
    .single();

  const companyName = tenant?.company_name || 'staffbase';

  const emails = employees.map((e) => {
    const { subject, html, text } = buildReminderEmail({
      category,
      employeeName: `${e.last_name} ${e.first_name}`,
      companyName,
      appUrl,
    });
    return { from: FROM_EMAIL, to: [e.email as string], subject, html, text };
  });

  // Resend batch API は 100件/call 上限
  for (let i = 0; i < emails.length; i += 100) {
    await resend.batch.send(emails.slice(i, i + 100));
  }

  return NextResponse.json({ ok: true, sent: employees.length });
}
