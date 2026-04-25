import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET: テンプレートのタグ一覧取得
 * POST: タグの一括追加（column_key自動生成）
 * DELETE: タグ削除
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const templateId = req.nextUrl.searchParams.get('template_id');

  if (!templateId) {
    return NextResponse.json({ error: 'template_id が必要です' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('pdf_tags')
    .select('*')
    .eq('template_id', templateId)
    .order('column_key');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tags: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const body = await req.json();
  const { template_id, display_names, column_keys } = body as {
    template_id: string;
    display_names: string[];
    column_keys?: string[];  // employee mode: "employee.last_name" 等
  };

  if (!template_id || !display_names?.length) {
    return NextResponse.json({ error: 'template_id と display_names が必要です' }, { status: 400 });
  }

  let inserts: { template_id: string; column_key: string; display_name: string }[];

  if (column_keys && column_keys.length === display_names.length) {
    // employee mode: column_key が明示的に指定されている
    inserts = display_names.map((name, i) => ({
      template_id,
      column_key: column_keys[i],
      display_name: name,
    }));
  } else {
    // matrix mode: column_key を自動生成 (col_A, col_B, ...)
    const { data: existing } = await supabase
      .from('pdf_tags')
      .select('column_key')
      .eq('template_id', template_id)
      .like('column_key', 'col_%')
      .order('column_key', { ascending: false })
      .limit(1);

    let nextCharCode = 65; // 'A'
    if (existing && existing.length > 0) {
      const lastKey = existing[0].column_key;
      const lastChar = lastKey.replace('col_', '');
      nextCharCode = lastChar.charCodeAt(0) + 1;
    }

    inserts = display_names.map((name, i) => ({
      template_id,
      column_key: `col_${String.fromCharCode(nextCharCode + i)}`,
      display_name: name,
    }));
  }

  const { error } = await supabase
    .from('pdf_tags')
    .insert(inserts)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 全タグを返す
  const { data: allTags } = await supabase
    .from('pdf_tags')
    .select('*')
    .eq('template_id', template_id)
    .order('column_key');

  return NextResponse.json({ tags: allTags });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const tagId = req.nextUrl.searchParams.get('tag_id');

  if (!tagId) {
    return NextResponse.json({ error: 'tag_id が必要です' }, { status: 400 });
  }

  const { error } = await supabase
    .from('pdf_tags')
    .delete()
    .eq('id', tagId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
