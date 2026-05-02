-- 146: manager 用 部下取得 RPC
--
-- 背景:
-- migration 144 で employees テーブルに manager 用 SELECT RLS を追加したところ、
-- 全員ログアウト現象が発生（145 でロールバック済）。
-- RLS を一切いじらず、SECURITY DEFINER 関数で必要な部下情報だけ返す方式に変更。
--
-- 仕様:
-- - 呼び出し者が manager / shift_manager ロールでなければ空配列を返す
-- - 呼び出し者の管轄施設 (primary + manager_facilities) に所属する社員（自分以外）を返す
-- - 主所属 + 兼務（employee_facilities）両方含む
-- - SECURITY DEFINER なので RLS をバイパス。返すフィールドを明示制限することで
--   情報漏洩を防ぐ（住所・電話などプライベート項目は出さない）

/* "position" は PostgreSQL の予約語のため out 引数では使えない。employee_position に改名 */
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
  IF v_me_id IS NULL OR v_role NOT IN ('manager', 'shift_manager') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH managed_fids AS (
    SELECT facility_id FROM public.employees
      WHERE id = v_me_id AND facility_id IS NOT NULL
    UNION
    SELECT facility_id FROM public.manager_facilities
      WHERE employee_id = v_me_id
  )
  SELECT DISTINCT
    e.id,
    e.employee_number,
    e.last_name,
    e.first_name,
    e.position AS employee_position,
    e.status,
    e.join_date,
    e.facility_id,
    f.name AS facility_name
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

COMMENT ON FUNCTION public.get_my_subordinates() IS
  'manager / shift_manager の管轄施設に所属する社員（自分以外）を返す。RLS バイパス。';
