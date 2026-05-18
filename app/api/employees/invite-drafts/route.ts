import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 社員招待 下書き保存 API (一覧 + upsert)
 * - GET: 自分が作成した下書き一覧 (updated_at DESC)
 * - POST: id 指定なら UPDATE、なしなら INSERT。form_data + note を保存
 *
 * 認可: admin のみ。 RLS で「自分の下書き」のみアクセス可能。
 */

interface UpsertBody {
  id?: string;
  facility_id?: string | null;
  form_data: Record<string, unknown>;
  note?: string | null;
}

async function authAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) } as const;
  const { data: me } = await supabase
    .from('employees')
    .select('id, role, tenant_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || me.role !== 'admin') {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) } as const;
  }
  return { supabase, me } as const;
}

export async function GET() {
  const auth = await authAdmin();
  if ('error' in auth) return auth.error;
  const { supabase, me } = auth;

  const { data, error } = await supabase
    .from('invite_drafts')
    .select('id, tenant_id, admin_employee_id, facility_id, form_data, note, created_at, updated_at')
    .eq('admin_employee_id', me.id)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: '下書きの取得に失敗しました', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ drafts: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await authAdmin();
  if ('error' in auth) return auth.error;
  const { supabase, me } = auth;

  const body = (await request.json()) as UpsertBody;
  if (!body.form_data || typeof body.form_data !== 'object') {
    return NextResponse.json({ error: 'form_data は必須です' }, { status: 400 });
  }

  /* facility_id が指定されている場合、自テナント内の facility か検証 (他テナント漏れ防止) */
  if (body.facility_id) {
    const { data: fac } = await supabase
      .from('facilities')
      .select('id, tenant_id')
      .eq('id', body.facility_id)
      .maybeSingle();
    if (!fac || fac.tenant_id !== me.tenant_id) {
      return NextResponse.json({ error: '無効な facility_id です' }, { status: 400 });
    }
  }

  if (body.id) {
    /* UPDATE: id 指定。所有者チェックは RLS でカバー */
    const { data, error } = await supabase
      .from('invite_drafts')
      .update({
        facility_id: body.facility_id ?? null,
        form_data: body.form_data,
        note: body.note ?? null,
      })
      .eq('id', body.id)
      .eq('admin_employee_id', me.id) /* RLS の二重防御 */
      .select('id, tenant_id, admin_employee_id, facility_id, form_data, note, created_at, updated_at')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: '下書きの更新に失敗しました', detail: error?.message }, { status: 500 });
    }
    return NextResponse.json({ draft: data });
  }

  /* INSERT: 新規 */
  const { data, error } = await supabase
    .from('invite_drafts')
    .insert({
      tenant_id: me.tenant_id,
      admin_employee_id: me.id,
      facility_id: body.facility_id ?? null,
      form_data: body.form_data,
      note: body.note ?? null,
    })
    .select('id, tenant_id, admin_employee_id, facility_id, form_data, note, created_at, updated_at')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: '下書きの作成に失敗しました', detail: error?.message }, { status: 500 });
  }
  return NextResponse.json({ draft: data });
}
