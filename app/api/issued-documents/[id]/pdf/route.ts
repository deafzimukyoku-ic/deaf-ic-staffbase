/* 173: 発行済 PDF の取得 (本人 or admin / 管轄 manager のみ)
   GET /api/issued-documents/[id]/pdf
   - RLS の issued_docs_select でアクセス制御
   - revoked 済 / Storage 未保存は 404
   - 本人 SELECT で viewed_at に now を打つ (未閲覧時のみ) */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: rec } = await supabase
    .from('issued_documents')
    .select('id, employee_id, generated_pdf_path, revoked_at, viewed_at, document_template_id')
    .eq('id', id)
    .single();
  if (!rec) return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
  if (rec.revoked_at) return NextResponse.json({ error: '取り消し済みです' }, { status: 410 });
  if (!rec.generated_pdf_path) return NextResponse.json({ error: 'PDF がありません' }, { status: 404 });

  /* viewed_at: 本人初回閲覧時のみ更新 */
  const { data: me } = await supabase
    .from('employees')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();
  if (me && me.id === rec.employee_id && !rec.viewed_at) {
    await supabase
      .from('issued_documents')
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', id)
      .is('viewed_at', null);
  }

  /* テンプレ名取得してファイル名にする */
  const { data: tpl } = await supabase
    .from('document_templates')
    .select('name')
    .eq('id', rec.document_template_id)
    .single();

  /* Storage download は RLS (issued-docs select policy) で本人 / 管轄 admin・manager のみ可 */
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: file, error } = await admin.storage
    .from('issued-documents')
    .download(rec.generated_pdf_path);
  if (error || !file) {
    return NextResponse.json({ error: 'PDF の取得に失敗しました' }, { status: 500 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const fileName = `${(tpl?.name ?? 'document').replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Filename': encodeURIComponent(fileName),
    },
  });
}
