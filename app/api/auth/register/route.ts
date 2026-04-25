import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/register
 * Authユーザー作成 → テナント作成 → 管理者employeeレコード作成 → サンプル書類コピー
 * service_roleキーを使用してRLSをバイパスする
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { companyName, email, password } = body as {
    companyName: string;
    email: string;
    password: string;
  };

  if (!companyName || !email || !password) {
    return NextResponse.json(
      { error: '必須項目が不足しています' },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'パスワードは8文字以上で入力してください' },
      { status: 400 },
    );
  }

  // service_roleキーでSupabaseクライアント作成（RLSバイパス）
  const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. Authユーザー作成
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError || !authData.user) {
    // メールアドレス重複等
    const msg =
      authError?.message?.includes('already been registered')
        ? 'このメールアドレスは既に登録されています'
        : authError?.message ?? '登録に失敗しました';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const userId = authData.user.id;

  // 2. テナント作成
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert({
      company_name: companyName,
      representative_title: '',
      representative_name: '',
    })
    .select('id')
    .single();

  if (tenantError || !tenant) {
    // ロールバック: Authユーザーを削除
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: 'テナント作成に失敗しました' },
      { status: 500 },
    );
  }

  // 3. 管理者employeeレコード作成
  const { error: empError } = await supabaseAdmin.from('employees').insert({
    tenant_id: tenant.id,
    auth_user_id: userId,
    employee_number: 'ADMIN-001',
    email,
    role: 'admin',
    last_name: '',
    first_name: '',
    last_name_kana: '',
    first_name_kana: '',
    birth_date: '2000-01-01',
    postal_code: '',
    address: '',
    phone: '',
    join_date: new Date().toISOString().split('T')[0],
  });

  if (empError) {
    // ロールバック: テナントとAuthユーザーを削除
    await supabaseAdmin.from('tenants').delete().eq('id', tenant.id);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: '管理者作成に失敗しました' },
      { status: 500 },
    );
  }

  // 4. サンプル書類を自動コピー（失敗してもエラーにしない）
  const { data: samples } = await supabaseAdmin
    .from('document_templates')
    .select('*')
    .is('tenant_id', null)
    .eq('is_sample', true)
    .order('display_order');

  if (samples && samples.length > 0) {
    const copies = samples.map((s) => ({
      tenant_id: tenant.id,
      name: s.name,
      template_type: s.template_type,
      pdf_storage_path: s.pdf_storage_path,
      page_count: s.page_count,
      docx_storage_path: s.docx_storage_path,
      mapping: s.mapping,
      is_sample: false,
      display_order: s.display_order,
    }));

    const { data: inserted } = await supabaseAdmin
      .from('document_templates')
      .insert(copies)
      .select();

    // PDFテンプレートのタグ・配置をコピー
    if (inserted) {
      for (let i = 0; i < samples.length; i++) {
        const src = samples[i];
        const dest = inserted[i];
        if (!dest || src.template_type !== 'pdf') continue;

        const { data: srcTags } = await supabaseAdmin
          .from('pdf_tags')
          .select('*')
          .eq('template_id', src.id);

        if (!srcTags || srcTags.length === 0) continue;

        const tagIdMap = new Map<string, string>();
        const newTags = srcTags.map((t) => {
          const newId = crypto.randomUUID();
          tagIdMap.set(t.id, newId);
          return {
            id: newId,
            template_id: dest.id,
            column_key: t.column_key,
            display_name: t.display_name,
          };
        });

        await supabaseAdmin.from('pdf_tags').insert(newTags);

        const { data: srcPlacements } = await supabaseAdmin
          .from('pdf_tag_placements')
          .select('*')
          .eq('template_id', src.id);

        if (srcPlacements && srcPlacements.length > 0) {
          const newPlacements = srcPlacements.map((p) => ({
            template_id: dest.id,
            tag_id: tagIdMap.get(p.tag_id) || p.tag_id,
            page_number: p.page_number,
            x: p.x,
            y: p.y,
            font_size: p.font_size,
          }));

          await supabaseAdmin.from('pdf_tag_placements').insert(newPlacements);
        }
      }
    }
  }

  return NextResponse.json({ success: true });
}
