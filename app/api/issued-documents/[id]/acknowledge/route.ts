/* 173: 自分宛発行書類の受領確認 (acknowledged_at を打つ)
   POST /api/issued-documents/[id]/acknowledge
   - 本人のみ。RLS の issued_docs_update_self が auth を保証 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('issued_documents')
    .update({ acknowledged_at: nowIso, viewed_at: nowIso })
    .eq('id', id)
    .is('acknowledged_at', null); /* 多重押下で先勝ちを保証 */

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, acknowledged_at: nowIso });
}
