import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET: テンプレートのマトリクス行一覧取得
 * POST: マトリクス行のUPSERT（全行置換）
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const templateId = req.nextUrl.searchParams.get('template_id');

  if (!templateId) {
    return NextResponse.json({ error: 'template_id が必要です' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('matrix_rows')
    .select('*')
    .eq('template_id', templateId)
    .order('row_index');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const body = await req.json();
  const { template_id, rows } = body as {
    template_id: string;
    rows: { row_index: number; row_data: Record<string, string> }[];
  };

  if (!template_id) {
    return NextResponse.json({ error: 'template_id が必要です' }, { status: 400 });
  }

  // 既存行を全削除してから挿入（UPSERT代替、シンプルで確実）
  const { error: delErr } = await supabase
    .from('matrix_rows')
    .delete()
    .eq('template_id', template_id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  if (rows && rows.length > 0) {
    const inserts = rows.map((r) => ({
      template_id,
      row_index: r.row_index,
      row_data: r.row_data,
    }));

    const { error: insErr } = await supabase
      .from('matrix_rows')
      .insert(inserts);

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // 保存後のデータを返す
  const { data } = await supabase
    .from('matrix_rows')
    .select('*')
    .eq('template_id', template_id)
    .order('row_index');

  return NextResponse.json({ rows: data });
}
