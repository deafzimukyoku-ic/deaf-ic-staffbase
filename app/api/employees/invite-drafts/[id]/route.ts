import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 社員招待 下書き削除 API
 * - DELETE: 自分の下書き 1 件を物理削除
 *
 * 認可: admin のみ + RLS で「自分の下書き」のみアクセス可能。
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id が必要です' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const { error } = await supabase
    .from('invite_drafts')
    .delete()
    .eq('id', id)
    .eq('admin_employee_id', me.id); /* RLS の二重防御 */

  if (error) {
    return NextResponse.json({ error: '下書きの削除に失敗しました', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
