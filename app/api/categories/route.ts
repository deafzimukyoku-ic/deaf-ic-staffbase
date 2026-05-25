import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { CategoryType } from '@/lib/types';

const VALID_TYPES: CategoryType[] = ['compliance', 'training', 'announcement', 'manual'];

// GET /api/categories?type=compliance  (type省略時は全type返す)
export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('employees')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!me) {
    return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  }

  const type = req.nextUrl.searchParams.get('type');
  let query = supabase
    .from('categories')
    .select('*')
    .eq('tenant_id', me.tenant_id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (type) {
    if (!VALID_TYPES.includes(type as CategoryType)) {
      return NextResponse.json({ error: '無効なカテゴリ種別です' }, { status: 400 });
    }
    query = query.eq('type', type);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'カテゴリの取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

// POST /api/categories  body: { type, name, color, icon }
export async function POST(req: NextRequest) {
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
    type?: string;
    name?: string;
    color?: string;
    icon?: string;
    target_type?: 'all' | 'facility';
    target_facility_ids?: string[];
  };

  if (!body.type || !VALID_TYPES.includes(body.type as CategoryType)) {
    return NextResponse.json({ error: '無効なカテゴリ種別です' }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: 'カテゴリ名を入力してください' }, { status: 400 });
  }
  if (name.length > 30) {
    return NextResponse.json({ error: 'カテゴリ名は30文字以内で入力してください' }, { status: 400 });
  }

  /* v2 (205): audience 検証 */
  const targetType: 'all' | 'facility' = body.target_type ?? 'all';
  const targetFacilityIds = Array.isArray(body.target_facility_ids) ? body.target_facility_ids : [];

  if (!['all', 'facility'].includes(targetType)) {
    return NextResponse.json({ error: 'target_type が不正です' }, { status: 400 });
  }
  if (targetType === 'facility' && targetFacilityIds.length === 0) {
    return NextResponse.json({ error: 'target_type=facility のとき target_facility_ids は必須です' }, { status: 400 });
  }

  let myEmployeeId: string | null = null;
  if (me.role === 'manager') {
    if (targetType !== 'facility') {
      return NextResponse.json({ error: 'マネージャーは「全社共通」カテゴリを作成できません' }, { status: 403 });
    }
    const { data: meFull } = await supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();
    myEmployeeId = meFull?.id ?? null;
    const { data: myFacs } = await supabase.rpc('get_my_facility_ids');
    const myFacIds = new Set(((myFacs as Array<string> | null) ?? []).map(String));
    const allIn = targetFacilityIds.every((id) => myFacIds.has(id));
    if (!allIn) {
      return NextResponse.json({ error: 'あなたが管理していない事業所が含まれています' }, { status: 403 });
    }
  } else if (me.role === 'admin' || me.role === 'super_admin') {
    const { data: meFull } = await supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();
    myEmployeeId = meFull?.id ?? null;
  }

  // 既存の最大sort_orderを取得して末尾に追加
  const { data: maxRow } = await supabase
    .from('categories')
    .select('sort_order')
    .eq('tenant_id', me.tenant_id)
    .eq('type', body.type)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('categories')
    .insert({
      tenant_id: me.tenant_id,
      type: body.type as CategoryType,
      name,
      color: body.color || '#6B7280',
      icon: body.icon || '📁',
      sort_order: nextOrder,
      target_type: targetType,
      target_facility_ids: targetFacilityIds,
      created_by: myEmployeeId,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '同じ名前のカテゴリが既に存在します' }, { status: 409 });
    }
    return NextResponse.json({ error: 'カテゴリの作成に失敗しました', detail: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PATCH /api/categories  body: { orders: [{ id, sort_order }, ...] }
// D&D並び替え用一括更新
export async function PATCH(req: NextRequest) {
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

  const body = await req.json() as { orders?: { id: string; sort_order: number }[] };
  if (!Array.isArray(body.orders)) {
    return NextResponse.json({ error: 'orders配列が必要です' }, { status: 400 });
  }

  // 他テナントのカテゴリを混入できないよう、IDで一旦絞り込んで所有確認
  const ids = body.orders.map(o => o.id);
  const { data: owned } = await supabase
    .from('categories')
    .select('id')
    .eq('tenant_id', me.tenant_id)
    .in('id', ids);

  const ownedSet = new Set((owned || []).map(r => r.id));
  for (const o of body.orders) {
    if (!ownedSet.has(o.id)) {
      return NextResponse.json({ error: '権限のないカテゴリが含まれています' }, { status: 403 });
    }
  }

  // 並び替えは件数が少ないので逐次更新で十分
  for (const o of body.orders) {
    await supabase
      .from('categories')
      .update({ sort_order: o.sort_order })
      .eq('id', o.id)
      .eq('tenant_id', me.tenant_id);
  }

  return NextResponse.json({ ok: true });
}
