-- 187: get_my_subordinate_progress RPC を 185 (employee_progress) と同じ
--      「公開 + 現バージョン一致」フィルタに揃える
--
-- 背景:
-- 183 で position_id + additional_facility_ids[] を追加したが、内部の count(*) は
-- 旧仕様 (素 count) のままで、非公開化されたアイテムの ack/read や、書類編集後の
-- 旧版 compliance ack も数えてしまい mgr/dashboard で「分母超え」が再現する。
--
-- 修正:
-- count(*) サブクエリを 185 と同じ JOIN+filter に揃える。返却カラムは 183 のまま維持
-- (position_id + additional_facility_ids[] も保持) するため、RETURNS TABLE 構造は不変。
-- それでも CREATE OR REPLACE で内部実装だけ差し替え (RETURNS TABLE 不変なので DROP 不要)。

CREATE OR REPLACE FUNCTION public.get_my_subordinate_progress(p_facility_id uuid DEFAULT NULL)
RETURNS TABLE (
  employee_id uuid,
  tenant_id uuid,
  last_name text,
  first_name text,
  last_name_kana text,
  first_name_kana text,
  status text,
  facility_id uuid,
  docs_submitted bigint,
  compliance_done bigint,
  trainings_passed bigint,
  announcements_read bigint,
  manuals_read bigint,
  last_doc_submitted_at timestamptz,
  last_compliance_at timestamptz,
  last_training_at timestamptz,
  last_announcement_at timestamptz,
  last_manual_at timestamptz,
  position_id uuid,
  additional_facility_ids uuid[]
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
  IF v_role NOT IN ('admin', 'manager', 'shift_manager') THEN RETURN; END IF;

  IF v_role IN ('manager', 'shift_manager') AND p_facility_id IS NOT NULL THEN
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
  ),
  target_emps AS (
    SELECT DISTINCT
      e.id           AS emp_id,
      e.tenant_id    AS emp_tenant_id,
      e.last_name    AS emp_last_name,
      e.first_name   AS emp_first_name,
      e.last_name_kana   AS emp_last_name_kana,
      e.first_name_kana  AS emp_first_name_kana,
      e.status       AS emp_status,
      e.facility_id  AS emp_facility_id,
      e.position_id  AS emp_position_id
    FROM public.employees e
    LEFT JOIN public.employee_facilities ef ON ef.employee_id = e.id
    WHERE e.tenant_id = v_tenant
      AND e.id <> v_me_id
      AND (
        v_role = 'admin'
        OR e.facility_id IN (SELECT mf.fid FROM managed_fids mf)
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
  ),
  emp_additional_facilities AS (
    SELECT ef.employee_id AS emp_id, array_agg(DISTINCT ef.facility_id) AS additional_facilities
    FROM public.employee_facilities ef
    WHERE ef.employee_id IN (SELECT te.emp_id FROM target_emps te)
    GROUP BY ef.employee_id
  )
  SELECT
    te.emp_id,
    te.emp_tenant_id,
    te.emp_last_name,
    te.emp_first_name,
    te.emp_last_name_kana,
    te.emp_first_name_kana,
    te.emp_status,
    te.emp_facility_id,
    (SELECT count(*) FROM public.document_submissions ds
       WHERE ds.employee_id = te.emp_id AND ds.status = 'submitted'),
    /* 187: 公開 + 現バージョン一致 にフィルタ (185 と同じ集計) */
    (SELECT count(*) FROM public.compliance_acknowledgments ca
       JOIN public.compliance_documents cd ON cd.id = ca.compliance_document_id
       WHERE ca.employee_id = te.emp_id
         AND cd.is_published = true
         AND ca.document_updated_at = cd.updated_at),
    (SELECT count(*) FROM public.training_submissions ts
       JOIN public.trainings t ON t.id = ts.training_id
       WHERE ts.employee_id = te.emp_id
         AND ts.result = 'passed'
         AND t.is_published = true),
    (SELECT count(*) FROM public.announcement_reads ar
       JOIN public.announcements a ON a.id = ar.announcement_id
       WHERE ar.employee_id = te.emp_id
         AND a.is_published = true),
    (SELECT count(*) FROM public.manual_reads mr
       JOIN public.manuals m ON m.id = mr.manual_id
       WHERE mr.employee_id = te.emp_id
         AND m.is_published = true),
    (SELECT max(ds.submitted_at) FROM public.document_submissions ds
       WHERE ds.employee_id = te.emp_id AND ds.status = 'submitted'),
    (SELECT max(ca.acknowledged_at) FROM public.compliance_acknowledgments ca
       JOIN public.compliance_documents cd ON cd.id = ca.compliance_document_id
       WHERE ca.employee_id = te.emp_id
         AND cd.is_published = true
         AND ca.document_updated_at = cd.updated_at),
    (SELECT max(ts.submitted_at) FROM public.training_submissions ts
       JOIN public.trainings t ON t.id = ts.training_id
       WHERE ts.employee_id = te.emp_id
         AND ts.result = 'passed'
         AND t.is_published = true),
    (SELECT max(ar.read_at) FROM public.announcement_reads ar
       JOIN public.announcements a ON a.id = ar.announcement_id
       WHERE ar.employee_id = te.emp_id
         AND a.is_published = true),
    (SELECT max(mr.read_at) FROM public.manual_reads mr
       JOIN public.manuals m ON m.id = mr.manual_id
       WHERE mr.employee_id = te.emp_id
         AND m.is_published = true),
    te.emp_position_id,
    COALESCE(eaf.additional_facilities, ARRAY[]::uuid[])
  FROM target_emps te
  LEFT JOIN emp_additional_facilities eaf ON eaf.emp_id = te.emp_id
  ORDER BY te.emp_last_name, te.emp_first_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

GRANT EXECUTE ON FUNCTION public.get_my_subordinate_progress(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_subordinate_progress(uuid) IS
  '187: 156/171/183 に加え、187 で count を「公開 + 現バージョン一致」にフィルタ。
   employee_progress view (185) と完全に集計仕様が揃い、mgr 画面でも 52/51 等の
   分母超えが起きない。RETURNS TABLE 構造は 183 と同じため client 側変更不要。';

NOTIFY pgrst, 'reload schema';
