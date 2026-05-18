/* 173: 発行済書類の取り消し
   POST /api/issued-documents/[id]/revoke { reason? }
   - admin / 管轄 manager のみ。RLS の issued_docs_update_admin が auth を保証
   - 取り消し後は Storage の PDF も削除して DL 不可にする */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: me } = await supabase
    .from('employees')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .single();
  if (!me || (me.role !== 'admin' && me.role !== 'manager')) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason ?? '').trim() || null;

  /* RLS で対象外を弾く前提で SELECT → 取り消し */
  const { data: rec } = await supabase
    .from('issued_documents')
    .select('id, generated_pdf_path, revoked_at')
    .eq('id', id)
    .single();
  if (!rec) return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
  if (rec.revoked_at) {
    return NextResponse.json({ error: '既に取り消し済みです' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('issued_documents')
    .update({ revoked_at: nowIso, revoked_by: me.id, revoked_reason: reason })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  /* Storage 削除は service-role 経由 (Storage RLS は SELECT のみ定義済) */
  if (rec.generated_pdf_path) {
    const admin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    await admin.storage.from('issued-documents').remove([rec.generated_pdf_path]);
  }

  return NextResponse.json({ success: true, revoked_at: nowIso });
}
