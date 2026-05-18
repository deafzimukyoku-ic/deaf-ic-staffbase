-- 171: shift_manager を manager dashboard 部下進捗集計から除外
--
-- 背景:
-- 「シフト統括」(role='shift_manager') は職員一覧 / ダッシュボード / 進捗管理 /
-- リマインド対象から非表示にする運用に変更。
-- フロント側 (admin/dashboard, /api/reports, /api/admin/send-reminder) は
-- 同タイミングで .neq('role', 'shift_manager') を追加するが、
-- /mgr/dashboard 部下進捗一覧は get_my_subordinate_progress RPC 経由で
-- データを返すため、RPC 側でも除外する。
--
-- 156 自体は編集禁止 (CLAUDE.md §7「既存マイグレーション編集禁止」) のため、
-- CREATE OR REPLACE で本体だけ差し替える。シグネチャ・戻り値・GRANT・コメントは
-- 156 と完全同一 (rollback 時は 156 を再 apply で戻る)。
--
-- 変更点: target_emps CTE の WHERE 句に「e.role <> 'shift_manager'」を 1 行追加。
-- 他の構造は全く変更しない。

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
  last_manual_at timestamptz
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
  IF v_role NOT IN ('admin', 'super_admin', 'manager', 'shift_manager') THEN RETURN; END IF;

  /* manager / shift_manager: p_facility_id 指定があれば自管轄か検証。管轄外なら空返却 */
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
      e.id          AS emp_id,
      e.tenant_id   AS emp_tenant_id,
      e.last_name   AS emp_last_name,
      e.first_name  AS emp_first_name,
      e.last_name_kana  AS emp_last_name_kana,
      e.first_name_kana AS emp_first_name_kana,
      e.status      AS emp_status,
      e.facility_id AS emp_facility_id
    FROM public.employees e
    LEFT JOIN public.employee_facilities ef ON ef.employee_id = e.id
    WHERE e.tenant_id = v_tenant
      AND e.id <> v_me_id
      AND e.role <> 'shift_manager'           -- ★ 171 で追加: シフト統括を進捗一覧から除外
      AND (
        v_role IN ('admin', 'super_admin')
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
    (SELECT count(*) FROM public.compliance_acknowledgments ca
       WHERE ca.employee_id = te.emp_id),
    (SELECT count(*) FROM public.training_submissions ts
       WHERE ts.employee_id = te.emp_id AND ts.result = 'passed'),
    (SELECT count(*) FROM public.announcement_reads ar
       WHERE ar.employee_id = te.emp_id),
    (SELECT count(*) FROM public.manual_reads mr
       WHERE mr.employee_id = te.emp_id),
    (SELECT max(ds.submitted_at) FROM public.document_submissions ds
       WHERE ds.employee_id = te.emp_id AND ds.status = 'submitted'),
    (SELECT max(ca.acknowledged_at) FROM public.compliance_acknowledgments ca
       WHERE ca.employee_id = te.emp_id),
    (SELECT max(ts.submitted_at) FROM public.training_submissions ts
       WHERE ts.employee_id = te.emp_id AND ts.result = 'passed'),
    (SELECT max(ar.read_at) FROM public.announcement_reads ar
       WHERE ar.employee_id = te.emp_id),
    (SELECT max(mr.read_at) FROM public.manual_reads mr
       WHERE mr.employee_id = te.emp_id)
  FROM target_emps te
  ORDER BY te.emp_last_name, te.emp_first_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

GRANT EXECUTE ON FUNCTION public.get_my_subordinate_progress(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_subordinate_progress(uuid) IS
  'admin / manager / shift_manager 用 部下進捗集計 RPC。部下ごとの完了件数 + 各カテゴリ最終完了日時を返す。'
  '171 以降は shift_manager ロールの社員を対象から除外する (進捗管理対象外運用)。RLS バイパス。';

NOTIFY pgrst, 'reload schema';
