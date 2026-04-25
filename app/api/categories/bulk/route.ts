import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { CategoryType } from '@/lib/types';

/**
 * POST /api/categories/bulk
 * カテゴリの一括登録（他の分類からの取り込みなど）
 *
 * Body:
 *  {
 *    type: 'compliance' | 'training' | 'announcement' | 'manual',
 *    items: [{ name, color, icon }, ...],
 *    on_conflict: 'skip' | 'rename'  // 同名カテゴリ既存時の挙動
 *  }
 *
 * 動作:
 *  - 既存カテゴリ名を1クエリで取得
 *  - on_conflict='skip': 同名はスキップ
 *  - on_conflict='rename': 「(2)」「(3)」と連番付与
 *  - sort_order は既存最大値の次から連番
 *  - 新規分のみ 1回の insert で一括登録
 *
 * Response:
 *  { inserted: number, skipped: number, renamed: number, errors: string[] }
 */

const VALID_TYPES: CategoryType[] = ['compliance', 'training', 'announcement', 'manual'];

interface BulkItem {
  name: string;
  color: string;
  icon: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: me } = await supabase
    .from('employees')
    .select('tenant_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (!['admin', 'manager'].includes(me.role)) {
    return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
  }

  let body: { type?: string; items?: unknown; on_conflict?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエスト形式が不正です' }, { status: 400 });
  }

  const type = body.type as CategoryType;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: '無効なカテゴリ種別です' }, { status: 400 });
  }

  const onConflict = body.on_conflict === 'rename' ? 'rename' : 'skip';

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: '取り込むカテゴリがありません' }, { status: 400 });
  }

  // 入力検証
  const items: BulkItem[] = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const color = typeof r.color === 'string' ? r.color : '#94a3b8';
    const icon = typeof r.icon === 'string' && r.icon ? r.icon : '📁';
    if (!name) continue;
    if (name.length > 30) continue;
    items.push({ name, color, icon });
  }

  if (items.length === 0) {
    return NextResponse.json({ error: '有効なカテゴリがありません' }, { status: 400 });
  }

  // 既存カテゴリを1クエリで取得（重複チェック用）
  const { data: existing, error: fetchErr } = await supabase
    .from('categories')
    .select('name, sort_order')
    .eq('tenant_id', me.tenant_id)
    .eq('type', type);

  if (fetchErr) {
    return NextResponse.json({ error: '既存カテゴリの取得に失敗しました' }, { status: 500 });
  }

  const existingNames = new Set((existing ?? []).map((c) => c.name));
  const maxSortOrder = (existing ?? []).reduce<number>(
    (max, c) => Math.max(max, c.sort_order ?? 0),
    -1
  );

  // 重複処理
  const toInsert: { tenant_id: string; type: CategoryType; name: string; color: string; icon: string; sort_order: number }[] = [];
  let skipped = 0;
  let renamed = 0;
  let nextOrder = maxSortOrder + 1;

  for (const item of items) {
    if (existingNames.has(item.name)) {
      if (onConflict === 'skip') {
        skipped++;
        continue;
      }
      // rename: 「(2)」「(3)」... と連番付与
      let suffix = 2;
      let candidate = `${item.name}(${suffix})`;
      while (existingNames.has(candidate)) {
        suffix++;
        candidate = `${item.name}(${suffix})`;
      }
      existingNames.add(candidate);
      toInsert.push({
        tenant_id: me.tenant_id,
        type,
        name: candidate,
        color: item.color,
        icon: item.icon,
        sort_order: nextOrder++,
      });
      renamed++;
    } else {
      existingNames.add(item.name);
      toInsert.push({
        tenant_id: me.tenant_id,
        type,
        name: item.name,
        color: item.color,
        icon: item.icon,
        sort_order: nextOrder++,
      });
    }
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, skipped, renamed: 0, errors: [] });
  }

  // 一括 INSERT（PostgreSQL 単一トランザクション）
  const { error: insErr } = await supabase
    .from('categories')
    .insert(toInsert);

  if (insErr) {
    if (insErr.code === '23505') {
      // UNIQUE 制約違反（並行リクエストで重複が発生したケース）
      return NextResponse.json(
        { error: '同じ名前のカテゴリが他の操作で追加されました。再度お試しください。' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: '取り込みに失敗しました: ' + insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    inserted: toInsert.length,
    skipped,
    renamed,
    errors: [],
  });
}
