/**
 * シフト関連 API の共通認証・スコープ解決ヘルパー
 *
 * - admin: facility_id を query/body から指定可（指定なしで全件は不可、必ず1施設指定）
 * - manager: 自分の facility_id 固定（query 値が違っても上書き）
 * - employee: 一部 GET と自分の shift_requests / shift_change_requests 書き込みのみ許可
 *
 * 共通レスポンス: { error, status } を返した場合はそのまま NextResponse.json で返す。
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ShiftAuthContext {
  supabase: SupabaseClient;
  authUserId: string;
  employeeId: string;
  tenantId: string;
  role: 'admin' | 'manager' | 'employee';
  // 解決された facility_id。manager は自 facility 固定、admin は requestedFacilityId そのまま
  facilityId: string;
}

interface ResolveOptions {
  // 要求された facility_id。admin は通常必須だが allowAdminWithoutFacility=true で省略可。
  requestedFacilityId?: string | null;
  // 許可するロール。デフォルトは admin / manager。
  allowedRoles?: Array<'admin' | 'manager' | 'employee'>;
  // admin に対して facility_id 指定を必須にしない（承認APIなど、facility が申請から決まる場合）
  allowAdminWithoutFacility?: boolean;
}

export async function resolveShiftAuth(
  options: ResolveOptions = {}
): Promise<
  | { ok: true; ctx: ShiftAuthContext }
  | { ok: false; response: NextResponse }
> {
  const allowedRoles = options.allowedRoles ?? ['admin', 'manager'];
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: '認証が必要です' }, { status: 401 }),
    };
  }

  const { data: me } = await supabase
    .from('employees')
    .select('id, role, tenant_id, facility_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!me) {
    return {
      ok: false,
      response: NextResponse.json({ error: '社員情報が見つかりません' }, { status: 403 }),
    };
  }

  const role = me.role as 'admin' | 'manager' | 'employee';
  if (!allowedRoles.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    };
  }

  // facility 解決
  let facilityId: string;
  if (role === 'manager' || role === 'employee') {
    // 自 facility 固定
    if (!me.facility_id) {
      return {
        ok: false,
        response: NextResponse.json({ error: '所属事業所が未設定です' }, { status: 400 }),
      };
    }
    facilityId = me.facility_id;
  } else {
    // admin: 通常は facility_id 必須だが、allowAdminWithoutFacility=true で省略可
    if (!options.requestedFacilityId) {
      if (options.allowAdminWithoutFacility) {
        facilityId = '';
      } else {
        return {
          ok: false,
          response: NextResponse.json({ error: '事業所IDが必要です（facility_id）' }, { status: 400 }),
        };
      }
    } else {
      facilityId = options.requestedFacilityId;
    }
  }

  return {
    ok: true,
    ctx: {
      supabase: supabase as unknown as SupabaseClient,
      authUserId: user.id,
      employeeId: me.id,
      tenantId: me.tenant_id,
      role,
      facilityId,
    },
  };
}
