import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PROFILE_SECTION_KEYS } from '@/lib/constants';
import type { ProfileSectionKey } from '@/lib/constants';

export async function GET() {
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

  const { data, error } = await supabase
    .from('profile_section_visibility')
    .select('section_key, is_visible')
    .eq('tenant_id', me.tenant_id);

  if (error) {
    return NextResponse.json({ error: '表示設定の取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function PUT(req: NextRequest) {
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

  if (me.role !== 'admin') {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  const body = await req.json() as { sections: { section_key: string; is_visible: boolean }[] };

  if (!Array.isArray(body.sections)) {
    return NextResponse.json({ error: 'sections配列が必要です' }, { status: 400 });
  }

  const validKeys = new Set<string>(PROFILE_SECTION_KEYS);
  for (const s of body.sections) {
    if (!validKeys.has(s.section_key)) {
      return NextResponse.json({ error: `無効なセクションキー: ${s.section_key}` }, { status: 400 });
    }
  }

  for (const s of body.sections) {
    await supabase
      .from('profile_section_visibility')
      .upsert(
        {
          tenant_id: me.tenant_id,
          section_key: s.section_key as ProfileSectionKey,
          is_visible: s.is_visible,
        },
        { onConflict: 'tenant_id,section_key' }
      );
  }

  return NextResponse.json({ ok: true });
}
