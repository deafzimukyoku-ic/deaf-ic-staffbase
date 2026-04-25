import { NextRequest, NextResponse } from 'next/server';
import { resolveShiftAuth } from '@/lib/auth/shift-api-helpers';

/**
 * 送迎表 / 日次出力カードの児童 DnD 並び順記憶 API
 * 元: diletto-shift-maker/src/app/api/transport/child-order/route.ts (shift-puzzle Phase 35)
 *
 * GET /api/shifts/transport/child-order?facility_id=...
 *   facility 内の memory rows を全件返す。
 *
 * POST /api/shifts/transport/child-order
 *   { facility_id, signature, orders: Array<{ child_id, display_order }> }
 *   指定 (facility, signature) 配下を upsert。
 *
 * 認証: admin / manager のみ（facility-scoped）。
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const facilityId = url.searchParams.get('facility_id');

  const auth = await resolveShiftAuth({ requestedFacilityId: facilityId });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { data, error } = await ctx.supabase
    .from('child_display_order_memory')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('facility_id', ctx.facilityId)
    .order('slot_signature', { ascending: true })
    .order('display_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data ?? [] });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストの JSON が不正です' }, { status: 400 });
  }

  const facilityId = typeof body.facility_id === 'string' ? body.facility_id : null;
  const auth = await resolveShiftAuth({ requestedFacilityId: facilityId });
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const signature = body.signature;
  const orders = body.orders;

  if (typeof signature !== 'string' || signature.length === 0) {
    return NextResponse.json({ error: 'signature が必要です' }, { status: 400 });
  }
  if (!Array.isArray(orders) || orders.length === 0) {
    return NextResponse.json({ error: 'orders が必要です' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const rows = orders
    .map((o) => {
      const childId = (o as { child_id?: unknown })?.child_id;
      const order = (o as { display_order?: unknown })?.display_order;
      if (typeof childId !== 'string' || childId.length === 0) return null;
      if (typeof order !== 'number' || !Number.isFinite(order)) return null;
      if (seen.has(childId)) return null;
      seen.add(childId);
      return {
        tenant_id: ctx.tenantId,
        facility_id: ctx.facilityId,
        slot_signature: signature,
        child_id: childId,
        display_order: Math.trunc(order),
        updated_at: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ error: '有効な orders がありません' }, { status: 400 });
  }

  const { error } = await ctx.supabase
    .from('child_display_order_memory')
    .upsert(rows, { onConflict: 'tenant_id,facility_id,slot_signature,child_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: rows.length });
}
