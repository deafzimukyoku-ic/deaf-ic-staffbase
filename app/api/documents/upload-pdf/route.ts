import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { MAX_PDF_FILE_SIZE_MB, MAX_DOCUMENTS_PER_TENANT } from '@/lib/constants';
import { PDFDocument } from 'pdf-lib';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    // 認証チェック
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // テナント取得
    const { data: me } = await supabase
      .from('employees')
      .select('tenant_id, role')
      .eq('auth_user_id', user.id)
      .single();

    if (!me || (me.role !== 'admin')) {
      return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
    }

    // Service Roleクライアント（RLSバイパス）
    const adminClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // テナントのテンプレート数チェック
    const { count } = await adminClient
      .from('document_templates')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', me.tenant_id);

    if ((count ?? 0) >= MAX_DOCUMENTS_PER_TENANT) {
      return NextResponse.json(
        { error: `テンプレートは${MAX_DOCUMENTS_PER_TENANT}件までです` },
        { status: 400 }
      );
    }

    // FormData からファイル取得
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const name = (formData.get('name') as string) || '';
    const dataMode = (formData.get('data_mode') as string) || 'matrix';

    if (!file) {
      return NextResponse.json({ error: 'ファイルが必要です' }, { status: 400 });
    }

    // ファイル検証
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'PDFファイルのみアップロードできます' }, { status: 400 });
    }

    if (file.size > MAX_PDF_FILE_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `ファイルサイズは${MAX_PDF_FILE_SIZE_MB}MB以下にしてください` },
        { status: 400 }
      );
    }

    // PDFを読み込んでページ数を取得
    const arrayBuffer = await file.arrayBuffer();
    let pageCount: number;
    try {
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      pageCount = pdfDoc.getPageCount();
    } catch {
      return NextResponse.json({ error: '無効なPDFファイルです' }, { status: 400 });
    }

    // ファイル名をASCII安全な形式に変換（日本語ファイル名はSupabase Storageで400になる）
    const safeFileName = `${Date.now()}.pdf`;
    const storagePath = `${me.tenant_id}/${safeFileName}`;
    const { error: uploadErr } = await adminClient.storage
      .from('documents')
      .upload(storagePath, new Uint8Array(arrayBuffer), {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: 'ファイルの保存に失敗しました', detail: uploadErr.message },
        { status: 500 }
      );
    }

    // document_templates レコード作成（Service Roleで RLS バイパス）
    const { data: template, error: dbErr } = await adminClient
      .from('document_templates')
      .insert({
        tenant_id: me.tenant_id,
        name: name.trim() || file.name.replace('.pdf', ''),
        template_type: 'pdf',
        data_mode: dataMode,
        pdf_storage_path: storagePath,
        page_count: pageCount,
        mapping: [],
        visibility_condition: 'all',
      })
      .select()
      .single();

    if (dbErr || !template) {
      return NextResponse.json(
        { error: 'テンプレートの保存に失敗しました', detail: dbErr?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ template });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[upload-pdf] Unhandled error:', message);
    return NextResponse.json({ error: 'サーバーエラー', detail: message }, { status: 500 });
  }
}
