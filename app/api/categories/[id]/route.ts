import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/categories/[id]  body: { name?, color?, icon? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('tenant_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!me) {
    return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  }

  if (!['admin', 'manager'].includes(me.role)) {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  const body = await req.json() as {
    name?: string;
    color?: string;
    icon?: string;
    target_type?: 'all' | 'facility';
    target_facility_ids?: string[];
  };
  const patch: Record<string, unknown> = {};

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: 'カテゴリ名を入力してください' }, { status: 400 });
    }
    if (name.length > 30) {
      return NextResponse.json({ error: 'カテゴリ名は30文字以内で入力してください' }, { status: 400 });
    }
    patch.name = name;
  }
  if (typeof body.color === 'string') patch.color = body.color;
  if (typeof body.icon === 'string') patch.icon = body.icon;

  /* v2 (205): audience 更新 */
  if (body.target_type !== undefined || body.target_facility_ids !== undefined) {
    const targetType: 'all' | 'facility' = body.target_type ?? 'all';
    const targetFacilityIds = Array.isArray(body.target_facility_ids) ? body.target_facility_ids : [];

    if (!['all', 'facility'].includes(targetType)) {
      return NextResponse.json({ error: 'target_type が不正です' }, { status: 400 });
    }
    if (targetType === 'facility' && targetFacilityIds.length === 0) {
      return NextResponse.json({ error: 'target_type=facility のとき target_facility_ids は必須です' }, { status: 400 });
    }

    if (me.role === 'manager') {
      if (targetType !== 'facility') {
        return NextResponse.json({ error: 'マネージャーは「全社共通」に変更できません' }, { status: 403 });
      }
      const { data: myFacs } = await supabase.rpc('get_my_managed_facility_ids');
      const myFacIds = new Set(((myFacs as Array<string> | null) ?? []).map(String));
      const allIn = targetFacilityIds.every((id) => myFacIds.has(id));
      if (!allIn) {
        return NextResponse.json({ error: 'あなたが管理していない事業所が含まれています' }, { status: 403 });
      }
    }

    patch.target_type = targetType;
    patch.target_facility_ids = targetFacilityIds;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '更新内容がありません' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('categories')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', me.tenant_id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前のカテゴリが既に存在します' }, { status: 409 });
    }
    return NextResponse.json({ error: 'カテゴリの更新に失敗しました' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'カテゴリが見つかりません' }, { status: 404 });
  }

  return NextResponse.json(data);
}

// DELETE /api/categories/[id]
// 使用中カテゴリは削除不可（compliance_documents / trainings / announcements / manuals を事前チェック）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('tenant_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!me) {
    return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  }

  if (!['admin', 'manager'].includes(me.role)) {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  // 所有権確認
  const { data: cat } = await supabase
    .from('categories')
    .select('id, type, tenant_id')
    .eq('id', id)
    .eq('tenant_id', me.tenant_id)
    .maybeSingle();

  if (!cat) {
    return NextResponse.json({ error: 'カテゴリが見つかりません' }, { status: 404 });
  }

  // 使用中チェック: typeに応じて紐付けテーブルをcount
  // migration 091 で manual を追加 (categories.type CHECK と同期)
  const tableByType: Record<string, string> = {
    compliance: 'compliance_documents',
    training: 'trainings',
    announcement: 'announcements',
    manual: 'manuals',
  };
  const targetTable = tableByType[cat.type];
  if (!targetTable) {
    return NextResponse.json({ error: '不正なカテゴリ種別です' }, { status: 500 });
  }

  const { count, error: countError } = await supabase
    .from(targetTable)
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);

  if (countError) {
    return NextResponse.json({ error: '使用状況の確認に失敗しました' }, { status: 500 });
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `この分類は${count}件で使用中のため削除できません。先に紐付いた項目のカテゴリを変更または削除してください。` },
      { status: 409 }
    );
  }

  const { error: delError } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('tenant_id', me.tenant_id);

  if (delError) {
    // ON DELETE RESTRICT による保険
    if (delError.code === '23503') {
      return NextResponse.json(
        { error: 'この分類は使用中のため削除できません' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'カテゴリの削除に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
