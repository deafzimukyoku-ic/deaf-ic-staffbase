import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 閲覧レポート API
 *
 * GET /api/reports?category=compliance|training|announcement|manual&days=30|all
 *
 * 4種類のコンテンツ（遵守事項 / 研修 / お知らせ / 業務マニュアル）について
 * 「誰が・どのアイテムを・何回・最後にいつ閲覧したか」を集計して返す。
 *
 * 集計元:
 *   - {category}_view_logs（migration 111、append-only）
 *   - {category} 本体テーブル（target_type / target_facility_ids でオーディエンスを絞る）
 *   - employees（active のみ）
 *
 * クライアント側で matrix（社員 × アイテム）を組み立ててサマリ表示。
 */

const CATEGORY_CONFIG = {
  compliance: { itemsTable: 'compliance_documents', viewsTable: 'compliance_view_logs', titleField: 'title' },
  training:   { itemsTable: 'trainings',            viewsTable: 'training_view_logs',   titleField: 'title' },
  announcement: { itemsTable: 'announcements',       viewsTable: 'announcement_view_logs', titleField: 'title' },
  manual:     { itemsTable: 'manuals',              viewsTable: 'manual_view_logs',     titleField: 'title' },
} as const;

type Category = keyof typeof CATEGORY_CONFIG;

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { data: me } = await supabase
    .from('employees')
    .select('id, tenant_id, role, facility_id')
    .eq('auth_user_id', user.id)
    .single();
  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (me.role !== 'admin' && me.role !== 'manager') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const category = req.nextUrl.searchParams.get('category') as Category | null;
  if (!category || !(category in CATEGORY_CONFIG)) {
    return NextResponse.json({ error: '無効な category です' }, { status: 400 });
  }
  const cfg = CATEGORY_CONFIG[category];

  /* days=30|7|all。指定無しは全期間。view_logs 側に viewed_at >= の条件を入れる。 */
  const daysParam = req.nextUrl.searchParams.get('days');
  let sinceIso: string | null = null;
  if (daysParam && daysParam !== 'all') {
    const days = parseInt(daysParam, 10);
    if (!isNaN(days) && days > 0) {
      sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
    }
  }

  /* manager は担当事業所の社員のみ。manager_facilities + 自分の facility_id を集める。
     admin は全社員（tenant 内）。 */
  let allowedFacilityIds: string[] | null = null;
  if (me.role === 'manager') {
    const ids = new Set<string>();
    if (me.facility_id) ids.add(me.facility_id);
    const { data: mfs } = await supabase
      .from('manager_facilities')
      .select('facility_id')
      .eq('employee_id', me.id);
    for (const mf of (mfs || [])) ids.add(mf.facility_id as string);
    allowedFacilityIds = Array.from(ids);
    if (allowedFacilityIds.length === 0) {
      return NextResponse.json({ items: [], employees: [], views: [] });
    }
  }

  /* items: アイテム本体。target_type / target_facility_ids / category_id を含める。
     compliance/training/announcement/manual すべて 036 / 091 で同じ列構成 + 034 で category_id 追加済。
     並び順は admin/{category} ページと揃える: sort_order ASC（NULL は末尾）→ created_at ASC。 */
  const itemsSel = `id, ${cfg.titleField}, target_type, target_facility_ids, category_id, sort_order, created_at`;
  const { data: itemsData, error: itemsErr } = await supabase
    .from(cfg.itemsTable)
    .select(itemsSel)
    .eq('tenant_id', me.tenant_id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  /* このカテゴリ種別のカテゴリ一覧（フロントのフィルタドロップダウン用） */
  const { data: categoriesData } = await supabase
    .from('categories')
    .select('id, name, icon, color')
    .eq('tenant_id', me.tenant_id)
    .eq('type', category)
    .order('sort_order', { ascending: true });

  /* employees: active な社員。manager の場合は担当 facility に絞る。
     対象オーディエンス（target_type='all' / 'facility'）の判定にも使う。
     171: shift_manager は閲覧レポート対象から除外 (運用上「進捗管理対象外」) */
  let empQuery = supabase
    .from('employees')
    .select('id, employee_number, last_name, first_name, facility_id, role, status')
    .eq('tenant_id', me.tenant_id)
    .eq('status', 'active')
    .neq('role', 'shift_manager');
  if (allowedFacilityIds) empQuery = empQuery.in('facility_id', allowedFacilityIds);
  const { data: employeesData, error: empErr } = await empQuery;
  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 });

  /* facility 名解決 */
  const { data: facilities } = await supabase
    .from('facilities')
    .select('id, name')
    .eq('tenant_id', me.tenant_id);
  const facMap = new Map((facilities || []).map((f) => [f.id, f.name]));

  /* views: tenant 内の閲覧ログ全部を 1 クエリで取って、クライアント側で集計しても良いが、
     SQL 側で GROUP BY して count + max(viewed_at) を返した方が転送量削減。
     Supabase は raw SQL を直接叩けないので、view_logs を全件取って JS で集計する。
     append-only でもログ数 = 社員数 × アイテム数 × 平均閲覧回数 程度なので現実的。 */
  let viewsQuery = supabase
    .from(cfg.viewsTable)
    .select('employee_id, item_id, viewed_at')
    .eq('tenant_id', me.tenant_id);
  if (sinceIso) viewsQuery = viewsQuery.gte('viewed_at', sinceIso);
  const { data: rawViews, error: viewsErr } = await viewsQuery;
  if (viewsErr) return NextResponse.json({ error: viewsErr.message }, { status: 500 });

  /* (employee_id, item_id) で集計: count, 最終閲覧日時, 直近10件の閲覧日時 (新しい順)
     recent_viewed_at は ② tooltip 表示用 (ホバー時に最新10件を YYYY/MM/DD HH:mm:ss で表示) */
  const aggMap = new Map<string, { employee_id: string; item_id: string; count: number; last_viewed_at: string; viewed_at_list: string[] }>();
  for (const v of (rawViews || []) as { employee_id: string; item_id: string; viewed_at: string }[]) {
    const key = `${v.employee_id}__${v.item_id}`;
    const cur = aggMap.get(key);
    if (cur) {
      cur.count += 1;
      if (v.viewed_at > cur.last_viewed_at) cur.last_viewed_at = v.viewed_at;
      cur.viewed_at_list.push(v.viewed_at);
    } else {
      aggMap.set(key, {
        employee_id: v.employee_id,
        item_id: v.item_id,
        count: 1,
        last_viewed_at: v.viewed_at,
        viewed_at_list: [v.viewed_at],
      });
    }
  }
  /* 各セルの viewed_at_list を 新しい順にソート → 上位 10 件のみ残す */
  const views = Array.from(aggMap.values()).map((v) => ({
    employee_id: v.employee_id,
    item_id: v.item_id,
    count: v.count,
    last_viewed_at: v.last_viewed_at,
    recent_views: v.viewed_at_list.sort((a, b) => b.localeCompare(a)).slice(0, 10),
  }));

  /* category=='training' のときだけ、研修提出データを追加で取得して ① 判定ボタン用に返す。
     セルから直接 合格/不合格/再提出 を判定できるようにする。 */
  type SubmissionRow = {
    id: string;
    training_id: string;
    employee_id: string;
    result: string;
    summary_text: string | null;
    admin_comment: string | null;
    submitted_at: string;
    reviewed_at: string | null;
  };
  let submissions: SubmissionRow[] = [];
  if (category === 'training') {
    const trainingIds = (itemsData || []).map((it) => (it as unknown as { id: string }).id);
    const employeeIds = (employeesData || []).map((e) => e.id);
    if (trainingIds.length > 0 && employeeIds.length > 0) {
      /* submitted_at DESC: 配列の先頭が最新。クライアント側で latest = [0]、history = 全体 として使う */
      const { data: subData } = await supabase
        .from('training_submissions')
        .select('id, training_id, employee_id, result, summary_text, admin_comment, submitted_at, reviewed_at')
        .in('training_id', trainingIds)
        .in('employee_id', employeeIds)
        .order('submitted_at', { ascending: false });
      submissions = (subData as SubmissionRow[]) || [];
    }
  }

  return NextResponse.json({
    items: ((itemsData || []) as unknown as Record<string, unknown>[]).map((it) => ({
      id: it.id,
      title: it[cfg.titleField] || '（無題）',
      target_type: it.target_type,
      target_facility_ids: it.target_facility_ids,
      category_id: it.category_id,
      created_at: it.created_at,
    })),
    categories: categoriesData || [],
    employees: (employeesData || []).map((e) => ({
      id: e.id,
      employee_number: e.employee_number ?? null,
      name: `${e.last_name} ${e.first_name}`,
      facility_id: e.facility_id,
      facility_name: e.facility_id ? (facMap.get(e.facility_id) || '') : '',
      role: e.role,
    })),
    views,
    submissions, /* category='training' のみ非空。判定ボタン UI で利用 */
  });
}
