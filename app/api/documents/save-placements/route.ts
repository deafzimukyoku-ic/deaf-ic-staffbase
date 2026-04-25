import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface PlacementInput {
  id?: string;
  tag_id: string;
  page_number: number;
  x: number;
  y: number;
  font_size: number;
}

/**
 * POST: テンプレートのタグ配置を全置換保存
 * 既存の配置を全削除 → 新規一括挿入
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const body = await req.json();
  const { template_id, placements } = body as {
    template_id: string;
    placements: PlacementInput[];
  };

  if (!template_id) {
    return NextResponse.json({ error: 'template_id が必要です' }, { status: 400 });
  }

  // 既存の配置を全削除
  const { error: delErr } = await supabase
    .from('pdf_tag_placements')
    .delete()
    .eq('template_id', template_id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // 新規挿入（配置がない場合はスキップ）
  if (placements && placements.length > 0) {
    const inserts = placements.map((p) => ({
      tag_id: p.tag_id,
      template_id,
      page_number: p.page_number,
      x: p.x,
      y: p.y,
      font_size: p.font_size,
    }));

    const { error: insErr } = await supabase
      .from('pdf_tag_placements')
      .insert(inserts);

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // 保存後の配置を返す
  const { data } = await supabase
    .from('pdf_tag_placements')
    .select('*')
    .eq('template_id', template_id)
    .order('page_number');

  return NextResponse.json({ placements: data });
}
