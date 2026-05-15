-- 156: manager / shift_manager 用 部下進捗集計 RPC
--
-- 背景:
-- /mgr/dashboard は部下の達成率（書類提出 / 遵守事項 / 研修 / お知らせ / マニュアル）を
-- employee_progress ビュー + document_submissions 等のテーブルを直接 SELECT して算出していた。
-- しかし employee_progress は security_invoker ビュー（migration 013 / 046 / 110）で、
-- 内部の count(*) サブクエリは呼び出し元（manager）の RLS で実行される。
-- manager は subordinate の document_submissions / compliance_acknowledgments /
-- announcement_reads / manual_reads / employees 行を読む RLS を持たない
-- （migration 144 で employees の manager SELECT を追加 → 145 で「全員ログアウト」発生のため
--   ロールバック。以降 migration 146〜149 は SECURITY DEFINER RPC で部下データを返す設計）。
-- 結果、manager ダッシュボードの達成率が全件 0% になっていた。
--
-- 修正:
-- /mgr/subordinates と同じ SECURITY DEFINER RPC 方式に統一。RLS は一切いじらない。
-- 部下ごとの完了件数 + 各カテゴリの最終完了日時を 1 RPC で返す。
--
-- 仕様:
-- - admin / super_admin : 自テナント全社員（自分以外）
-- - manager / shift_manager : 管轄施設（主所属 ∪ manager_facilities）に
--   主所属または兼務（employee_facilities）する社員（自分以外）
-- - employee : 何も返さない
-- - p_facility_id 指定時はその施設に絞る。manager が管轄外を指定したら空返却（情報漏洩防止）
-- - カウントは employee_progress ビューと同じ count(*) ロジックを踏襲
--
-- ambiguous 対策（migration 153 と同じ）:
-- RETURNS TABLE の列名が PL/pgSQL 内で OUT パラメータとして見えるため、
-- bare な列参照は全て alias 付きに、CTE の列は AS fid で改名して衝突を避ける。

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
  'admin / manager / shift_manager 用 部下進捗集計 RPC。部下ごとの完了件数 + 各カテゴリ最終完了日時を返す。RLS バイパス。';

NOTIFY pgrst, 'reload schema';
