/**
 * シフト関連 API の共通認証・スコープ解決ヘルパー
 *
 * - admin: facility_id を query/body から指定可（指定なしで全件は不可、必ず1施設指定）
 * - manager: 自分が管轄する施設 (主所属 ∪ manager_facilities) のいずれか。
 *   requestedFacilityId が無ければ主所属、あれば検証のうえそれを使う（migration 130/131）
 * - employee: 自分が所属する施設 (主所属 ∪ employee_facilities 兼任先) のいずれか。
 *   requestedFacilityId が無ければ主所属、あれば検証のうえそれを使う
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
  // 解決された facility_id。manager/employee は managed/belonging set に含まれることを検証済
  facilityId: string;
  // manager: 管轄施設 ID 集合（主所属 ∪ manager_facilities）
  // employee: 所属施設 ID 集合（主所属 ∪ employee_facilities 兼任先）
  // admin: 空配列（制限なしを示す）
  scopedFacilityIds: string[];
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

  // 自分のスコープ（管轄/所属）施設集合を解決
  let scopedFacilityIds: string[] = [];
  if (role === 'manager') {
    // 主所属 + manager_facilities
    const { data: managed } = await (supabase as unknown as SupabaseClient)
      .from('manager_facilities')
      .select('facility_id')
      .eq('employee_id', me.id);
    scopedFacilityIds = Array.from(
      new Set(
        [me.facility_id, ...(managed ?? []).map((r: { facility_id: string }) => r.facility_id)].filter(
          (v): v is string => !!v
        )
      )
    );
  } else if (role === 'employee') {
    // 主所属 + employee_facilities 兼任先
    const { data: belonging } = await (supabase as unknown as SupabaseClient)
      .from('employee_facilities')
      .select('facility_id')
      .eq('employee_id', me.id);
    scopedFacilityIds = Array.from(
      new Set(
        [me.facility_id, ...(belonging ?? []).map((r: { facility_id: string }) => r.facility_id)].filter(
          (v): v is string => !!v
        )
      )
    );
  }
  // admin は scopedFacilityIds=[] で「制限なし」を示す

  // facility 解決
  let facilityId: string;
  if (role === 'manager' || role === 'employee') {
    if (scopedFacilityIds.length === 0) {
      return {
        ok: false,
        response: NextResponse.json({ error: '所属事業所が未設定です' }, { status: 400 }),
      };
    }
    if (options.requestedFacilityId) {
      // 指定がある場合: 自分の管轄/所属に含まれるかを検証
      if (!scopedFacilityIds.includes(options.requestedFacilityId)) {
        return {
          ok: false,
          response: NextResponse.json({ error: '指定の事業所への権限がありません' }, { status: 403 }),
        };
      }
      facilityId = options.requestedFacilityId;
    } else {
      // 指定なし: 主所属（fallback）。主所属 NULL なら scope 集合の先頭
      facilityId = me.facility_id ?? scopedFacilityIds[0];
    }
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
      scopedFacilityIds,
    },
  };
}
