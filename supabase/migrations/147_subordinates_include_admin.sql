-- 147: get_my_subordinates を admin / shift_manager / manager で利用可に拡張
--
-- 背景:
-- 146 では manager / shift_manager のみ対象だった。
-- /mgr/subordinates ページに admin がアクセスした場合は空配列が返り、
-- 「部下が出てこない」状態になっていた。
-- admin は employees テーブル全件閲覧権限を持つので、
-- このページからも自テナントの全社員（自分以外）を見られるようにする。
--
-- もう 1 つ get_my_role_and_facilities() ヘルパを用意して
-- 「私のロール / 主所属 / 管轄施設」を返すようにする（UI 側のデバッグ用）。

CREATE OR REPLACE FUNCTION public.get_my_subordinates()
RETURNS TABLE (
  id uuid,
  employee_number text,
  last_name text,
  first_name text,
  employee_position text,
  status text,
  join_date date,
  facility_id uuid,
  facility_name text
) AS $$
DECLARE
  v_me_id uuid;
  v_role text;
  v_tenant uuid;
BEGIN
  SELECT e.id, e.role, e.tenant_id INTO v_me_id, v_role, v_tenant
  FROM public.employees e WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_me_id IS NULL THEN
    RETURN;
  END IF;

  /* admin / super_admin: 自テナントの全社員（自分以外） */
  IF v_role IN ('admin', 'super_admin') THEN
    RETURN QUERY
    SELECT
      e.id, e.employee_number, e.last_name, e.first_name,
      e.position AS employee_position, e.status, e.join_date,
      e.facility_id, f.name AS facility_name
    FROM public.employees e
    LEFT JOIN public.facilities f ON f.id = e.facility_id
    WHERE e.tenant_id = v_tenant
      AND e.id <> v_me_id
    ORDER BY e.employee_number;
    RETURN;
  END IF;

  /* manager / shift_manager: 管轄施設に主所属 or 兼務する社員 */
  IF v_role IN ('manager', 'shift_manager') THEN
    RETURN QUERY
    WITH managed_fids AS (
      SELECT facility_id FROM public.employees
        WHERE id = v_me_id AND facility_id IS NOT NULL
      UNION
      SELECT facility_id FROM public.manager_facilities
        WHERE employee_id = v_me_id
    )
    SELECT DISTINCT
      e.id, e.employee_number, e.last_name, e.first_name,
      e.position AS employee_position, e.status, e.join_date,
      e.facility_id, f.name AS facility_name
    FROM public.employees e
    LEFT JOIN public.facilities f ON f.id = e.facility_id
    LEFT JOIN public.employee_facilities ef ON ef.employee_id = e.id
    WHERE e.tenant_id = v_tenant
      AND e.id <> v_me_id
      AND (
        e.facility_id IN (SELECT facility_id FROM managed_fids)
        OR ef.facility_id IN (SELECT facility_id FROM managed_fids)
      )
    ORDER BY e.employee_number;
    RETURN;
  END IF;

  /* それ以外（employee 等）は何も返さない */
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

COMMENT ON FUNCTION public.get_my_subordinates() IS
  'admin / manager / shift_manager が自管轄の社員（admin は自テナント全件）を取得する。RLS バイパス。';

-- デバッグ / 表示用: 自分のロール + 管轄施設名
CREATE OR REPLACE FUNCTION public.get_my_managed_facilities_info()
RETURNS TABLE (
  my_role text,
  my_facility_id uuid,
  my_facility_name text,
  managed_facility_id uuid,
  managed_facility_name text
) AS $$
DECLARE
  v_me_id uuid;
BEGIN
  SELECT id INTO v_me_id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_me_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    me.role AS my_role,
    me.facility_id AS my_facility_id,
    primary_f.name AS my_facility_name,
    mf.facility_id AS managed_facility_id,
    managed_f.name AS managed_facility_name
  FROM public.employees me
  LEFT JOIN public.facilities primary_f ON primary_f.id = me.facility_id
  LEFT JOIN public.manager_facilities mf ON mf.employee_id = me.id
  LEFT JOIN public.facilities managed_f ON managed_f.id = mf.facility_id
  WHERE me.id = v_me_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;
