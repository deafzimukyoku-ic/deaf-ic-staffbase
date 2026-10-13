import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/multi-facility';

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

  /* getClaims(): JWT をローカル検証（Auth サーバーへの往復なし）。middleware・shifts dashboard と同じ方式。
     この API は DB と往復するたびに数百 ms かかっていた（2026-10-13 実測 7.5 秒）ため往復を 1 回でも減らす */
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (!userId) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const category = req.nextUrl.searchParams.get('category') as Category | null;
  if (!category || !(category in CATEGORY_CONFIG)) {
    return NextResponse.json({ error: '無効な category です' }, { status: 400 });
  }
  const cfg = CATEGORY_CONFIG[category];

  const { data: me } = await supabase
    .from('employees')
    .select('id, tenant_id, role, facility_id')
    .eq('auth_user_id', userId)
    .single();
  if (!me) return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
  if (me.role !== 'admin' && me.role !== 'manager') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  /* days=30|7|all。指定無しは全期間。view_logs 側に viewed_at >= の条件を入れる。 */
  const daysParam = req.nextUrl.searchParams.get('days');
  let sinceIso: string | null = null;
  if (daysParam && daysParam !== 'all') {
    const days = parseInt(daysParam, 10);
    if (!isNaN(days) && days > 0) {
      sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
    }
  }

  /* version_at: 旧版/現版 判定の基準列 (content-version-tracking, migration 188/189)。
     training は recert_at (admin が「再受講を求める」を選んだときだけ前進)、
     compliance/announcement/manual は updated_at (全編集で前進)。
     レスポンスでは version_at に正規化して返す。
     items の並び順は admin/{category} ページと揃える: sort_order ASC（NULL は末尾）→ created_at ASC。 */
  const versionCol = category === 'training' ? 'recert_at' : 'updated_at';
  const itemsSel = `id, ${cfg.titleField}, target_type, target_facility_ids, target_position_ids, category_id, sort_order, created_at, ${versionCol}`;

  /* 本人確認以外は互いに依存しないので全部同時に投げる。旧実装は 8 本前後を順番に await しており、
     その往復の積み重ねが閲覧レポートの遅さの主因だった（2026-10-13）。
     社員の事業所絞り込み（manager）と兼任の突き合わせは、取得後に JS で行う */

  let results;
  try {
    results = await Promise.all([
      me.role === 'manager'
        ? supabase.from('manager_facilities').select('facility_id').eq('employee_id', me.id)
        : Promise.resolve({ data: [] as { facility_id: string }[], error: null }),
      supabase
        .from(cfg.itemsTable)
        .select(itemsSel)
        .eq('tenant_id', me.tenant_id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }),
      /* このカテゴリ種別のカテゴリ一覧（フロントのフィルタドロップダウン用） */
      supabase
        .from('categories')
        .select('id, name, icon, color')
        .eq('tenant_id', me.tenant_id)
        .eq('type', category)
        .order('sort_order', { ascending: true }),
      /* active な社員。171: shift_manager は閲覧レポート対象から除外 (運用上「進捗管理対象外」) */
      supabase
        .from('employees')
        .select('id, employee_number, last_name, first_name, facility_id, position_id, role, status')
        .eq('tenant_id', me.tenant_id)
        .eq('status', 'active')
        .neq('role', 'shift_manager'),
      /* 兼任 facility。RLS (ef_tenant_read) で自テナント分だけ返る */
      supabase.from('employee_facilities').select('employee_id, facility_id'),
      supabase.from('facilities').select('id, name').eq('tenant_id', me.tenant_id),
      /* ページング必須（2026-10-13）: 単発取得だと PostgREST max-rows(1000) で黙って切れ、
         遵守事項 2020 行・お知らせ 1219 行のうち 1000 行しか集計されず「見たのに未読」が出ていた */
      fetchAllRows<{ employee_id: string; item_id: string; viewed_at: string }>(() => {
        let q = supabase
          .from(cfg.viewsTable)
          .select('employee_id, item_id, viewed_at')
          .eq('tenant_id', me.tenant_id);
        if (sinceIso) q = q.gte('viewed_at', sinceIso);
        /* ページ間で並びがぶれると取りこぼし・重複が起きるため順序を固定する */
        return q.order('id', { ascending: true });
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? '閲覧ログの取得に失敗しました';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const [mfRes, itemsRes, categoriesRes, employeesRes, efRes, facilitiesRes, viewsRows] = results;
  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  if (employeesRes.error) return NextResponse.json({ error: employeesRes.error.message }, { status: 500 });
  if (efRes.error) return NextResponse.json({ error: efRes.error.message }, { status: 500 });
  if (mfRes.error) return NextResponse.json({ error: mfRes.error.message }, { status: 500 });
  const itemsData = itemsRes.data;
  const categoriesData = categoriesRes.data;
  const rawViews = viewsRows;

  /* manager は担当事業所（manager_facilities + 自分の facility_id）の社員のみ。admin は全社員（tenant 内） */
  let employeesData = employeesRes.data ?? [];
  if (me.role === 'manager') {
    const allowed = new Set<string>((mfRes.data ?? []).map((mf) => mf.facility_id as string));
    if (me.facility_id) allowed.add(me.facility_id);
    if (allowed.size === 0) {
      return NextResponse.json({ items: [], employees: [], views: [] });
    }
    employeesData = employeesData.filter((e) => e.facility_id != null && allowed.has(e.facility_id));
  }

  /* 兼任 facility を employee_id でまとめて、ReportMatrix の audienceFor (isItemInAudience) に渡せる形にする */
  const efByEmp = new Map<string, string[]>();
  for (const r of (efRes.data ?? []) as { employee_id: string; facility_id: string }[]) {
    const arr = efByEmp.get(r.employee_id) ?? [];
    arr.push(r.facility_id);
    efByEmp.set(r.employee_id, arr);
  }

  const facMap = new Map((facilitiesRes.data || []).map((f) => [f.id, f.name]));

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
      /* 提出履歴は全期間で増え続けるので、閲覧ログと同じくページングで 1000 行上限を回避する */
      try {
        submissions = await fetchAllRows<SubmissionRow>(() =>
          supabase
            .from('training_submissions')
            .select('id, training_id, employee_id, result, summary_text, admin_comment, submitted_at, reviewed_at')
            .in('training_id', trainingIds)
            .in('employee_id', employeeIds)
            .order('submitted_at', { ascending: false })
            /* submitted_at が同時刻の行でページ境界がぶれないよう id で並びを確定させる */
            .order('id', { ascending: true }),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? '研修提出の取得に失敗しました';
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }
  }

  return NextResponse.json({
    items: ((itemsData || []) as unknown as Record<string, unknown>[]).map((it) => ({
      id: it.id,
      title: it[cfg.titleField] || '（無題）',
      target_type: it.target_type,
      target_facility_ids: it.target_facility_ids,
      target_position_ids: it.target_position_ids ?? null,
      category_id: it.category_id,
      created_at: it.created_at,
      /* 版基準日時。ReportMatrix が viewed_at と比較して現版/旧版を判定する。 */
      version_at: it[versionCol] ?? it.created_at,
    })),
    categories: categoriesData || [],
    employees: (employeesData || []).map((e) => ({
      id: e.id,
      employee_number: e.employee_number ?? null,
      name: `${e.last_name} ${e.first_name}`,
      facility_id: e.facility_id,
      facility_name: e.facility_id ? (facMap.get(e.facility_id) || '') : '',
      role: e.role,
      position_id: (e as { position_id?: string | null }).position_id ?? null,
      additional_facility_ids: efByEmp.get(e.id) ?? [],
    })),
    views,
    submissions, /* category='training' のみ非空。判定ボタン UI で利用 */
  });
}
