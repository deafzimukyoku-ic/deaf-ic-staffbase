-- 153: get_my_subordinates の "column reference facility_id is ambiguous" 修正
--
-- 問題:
-- migration 148 で導入した get_my_subordinates(p_facility_id) は
-- RETURNS TABLE (... facility_id uuid ...) を宣言している。PL/pgSQL では
-- RETURNS TABLE の列名が関数本体内で OUT パラメータとして参照可能になるため、
-- CTE / SELECT 内の bare `facility_id` がテーブル列と衝突して
-- "column reference is ambiguous" (SQLSTATE 42702) で失敗する。
--
-- 経緯:
-- migration 147 の no-arg 版 get_my_subordinates() がオーバーロードとして
-- 残っていた間は、PostgREST がそちらを呼んで本バグを踏まなかった。
-- 152 で no-arg を DROP したことで、1-arg 版が常に呼ばれるようになり
-- 潜在バグが顕在化。
--
-- 修正:
-- bare `facility_id` を全て qualifier 付きに書き換え:
--   - employees の列   → e.facility_id  (またはサブクエリで public.employees.facility_id)
--   - manager_facilities の列 → public.manager_facilities.facility_id
--   - employee_facilities の列 → ef.facility_id (alias)
--   - CTE managed_fids の列 → managed_fids.facility_id

CREATE OR REPLACE FUNCTION public.get_my_subordinates(p_facility_id uuid DEFAULT NULL)
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
  v_managed_count int;
BEGIN
  SELECT e.id, e.role, e.tenant_id INTO v_me_id, v_role, v_tenant
  FROM public.employees e WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_me_id IS NULL THEN RETURN; END IF;

  /* admin / super_admin: 自テナント全件、p_facility_id 指定があれば絞る */
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
      AND (p_facility_id IS NULL OR e.facility_id = p_facility_id)
    ORDER BY e.employee_number;
    RETURN;
  END IF;

  /* manager / shift_manager: 管轄施設に主所属または兼務する社員 */
  IF v_role IN ('manager', 'shift_manager') THEN
    /* p_facility_id 指定がある場合、自管轄か検証。管轄外なら空返却（情報漏洩防止）*/
    IF p_facility_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_managed_count FROM (
        SELECT e2.facility_id FROM public.employees e2
          WHERE e2.id = v_me_id AND e2.facility_id = p_facility_id
        UNION
        SELECT mf2.facility_id FROM public.manager_facilities mf2
          WHERE mf2.employee_id = v_me_id AND mf2.facility_id = p_facility_id
      ) s;
      IF v_managed_count = 0 THEN RETURN; END IF;
    END IF;

    RETURN QUERY
    WITH managed_fids AS (
      SELECT e2.facility_id AS fid FROM public.employees e2
        WHERE e2.id = v_me_id AND e2.facility_id IS NOT NULL
      UNION
      SELECT mf2.facility_id AS fid FROM public.manager_facilities mf2
        WHERE mf2.employee_id = v_me_id
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
        e.facility_id IN (SELECT mf.fid FROM managed_fids mf)
        OR ef.facility_id IN (SELECT mf.fid FROM managed_fids mf)
      )
      AND (
        p_facility_id IS NULL
        OR e.facility_id = p_facility_id
        OR EXISTS (
          SELECT 1 FROM public.employee_facilities ef2
          WHERE ef2.employee_id = e.id AND ef2.facility_id = p_facility_id
        )
      )
    ORDER BY e.employee_number;
    RETURN;
  END IF;

  /* employee: 何も返さない */
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

COMMENT ON FUNCTION public.get_my_subordinates(uuid) IS
  'admin / manager / shift_manager 用 部下取得 RPC。p_facility_id 指定でその施設のみに絞る。RLS バイパス。';

NOTIFY pgrst, 'reload schema';
