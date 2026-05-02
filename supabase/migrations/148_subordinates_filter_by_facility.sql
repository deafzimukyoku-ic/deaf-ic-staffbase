-- 148: get_my_subordinates にヘッダー選択中事業所フィルタを追加
--
-- 背景:
-- /mgr 配下は FacilityHeaderSelector による事業所セレクタがヘッダーにあり、
-- 他のシフト系画面（同席日数 / シフト表 / 送迎表 等）はこの選択値で絞られている。
-- /mgr/subordinates だけ全件表示で一貫性が無かった。
-- 引数で facility_id を受け取って絞り込むように更新。
--
-- セキュリティ:
-- - admin: 任意の事業所を指定可能（自テナント内）
-- - manager / shift_manager: 管轄外事業所を指定された場合は空を返す
-- - p_facility_id が NULL の時は従来挙動（admin=全件 / manager=全管轄）

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
        SELECT facility_id FROM public.employees WHERE id = v_me_id AND facility_id = p_facility_id
        UNION
        SELECT facility_id FROM public.manager_facilities WHERE employee_id = v_me_id AND facility_id = p_facility_id
      ) s;
      IF v_managed_count = 0 THEN RETURN; END IF;
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
      e.id, e.employee_number, e.last_name, e.first_name,
      e.position AS employee_position, e.status, e.join_date,
      e.facility_id, f.name AS facility_name
    FROM public.employees e
    LEFT JOIN public.facilities f ON f.id = e.facility_id
    LEFT JOIN public.employee_facilities ef ON ef.employee_id = e.id
    WHERE e.tenant_id = v_tenant
      AND e.id <> v_me_id
      AND (
        /* 管轄施設に主所属 or 兼務 */
        e.facility_id IN (SELECT facility_id FROM managed_fids)
        OR ef.facility_id IN (SELECT facility_id FROM managed_fids)
      )
      AND (
        /* 引数で絞り込み（指定された施設のみ） */
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
