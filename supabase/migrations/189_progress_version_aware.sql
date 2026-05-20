-- 189: employee_progress view + get_my_subordinate_progress RPC を
--      content-version-tracking の「現版閲覧済み」判定に揃える
--
-- 背景:
-- 185/187 は compliance のみ版考慮 (ca.document_updated_at = cd.updated_at)。
-- announcements / manuals / trainings は is_published だけで版を見ていないため、
-- 閲覧レポートを版考慮 (旧版/現版/未読) にすると、この 3 カテゴリで
-- 「レポート現版 < ダッシュボード」という逆向きの乖離が出る。
-- 189 で 3 カテゴリも版考慮にし、レポートとダッシュボードを構造的に一致させる。
--
-- 現版判定 (employee × item):
--   announcements : announcement_view_logs に viewed_at >= announcements.updated_at
--   manuals       : manual_view_logs に viewed_at >= manuals.updated_at
--   trainings     : result='passed' の submission で submitted_at >= trainings.recert_at
--   compliance    : 185 のまま (ack.document_updated_at = cd.updated_at)。
--                   ack 時に必ず view_log も生成されるため view_log ベース判定と一致。
--
-- 列構造は 185 (view 8 列) / 187 (RPC RETURNS TABLE 20 列) と完全に同一に保つ。
-- ダッシュボード UI (ProgressDashboard.tsx / mgr|admin/dashboard) は無変更で動く。

-- ============================================================
-- 1) employee_progress view
-- ============================================================
DROP VIEW IF EXISTS employee_progress;

CREATE VIEW employee_progress
WITH (security_invoker = true)
AS
  SELECT
    e.id AS employee_id,
    e.tenant_id,
    e.facility_id,
    (SELECT count(*) FROM document_submissions ds
      WHERE ds.employee_id = e.id AND ds.status = 'submitted') AS docs_submitted,

    /* compliance: 185 のまま (公開中 + 現バージョン ack) */
    (SELECT count(*) FROM compliance_acknowledgments ca
      JOIN compliance_documents cd ON cd.id = ca.compliance_document_id
      WHERE ca.employee_id = e.id
        AND cd.is_published = true
        AND ca.document_updated_at = cd.updated_at) AS compliance_done,

    /* trainings: 公開中 + 合格 + その合格提出が現 recert 版 (submitted_at >= recert_at)。
       1 研修 1 カウント (EXISTS で重複合格提出を排除)。 */
    (SELECT count(*) FROM trainings t
      WHERE t.is_published = true
        AND t.tenant_id = e.tenant_id
        AND EXISTS (
          SELECT 1 FROM training_submissions ts
          WHERE ts.training_id = t.id
            AND ts.employee_id = e.id
            AND ts.result = 'passed'
            AND ts.submitted_at >= t.recert_at
        )) AS trainings_passed,

    /* announcements: 公開中 + 現版閲覧 (view_log viewed_at >= updated_at) */
    (SELECT count(*) FROM announcements a
      WHERE a.is_published = true
        AND a.tenant_id = e.tenant_id
        AND EXISTS (
          SELECT 1 FROM announcement_view_logs avl
          WHERE avl.item_id = a.id
            AND avl.employee_id = e.id
            AND avl.viewed_at >= a.updated_at
        )) AS announcements_read,

    /* manuals: 公開中 + 現版閲覧 */
    (SELECT count(*) FROM manuals m
      WHERE m.is_published = true
        AND m.tenant_id = e.tenant_id
        AND EXISTS (
          SELECT 1 FROM manual_view_logs mvl
          WHERE mvl.item_id = m.id
            AND mvl.employee_id = e.id
            AND mvl.viewed_at >= m.updated_at
        )) AS manuals_read
  FROM employees e;

COMMENT ON VIEW employee_progress IS
  '189: 4機能の達成数。compliance は現バージョン ack、announcements/manuals は
   現版 view_log、trainings は現 recert 版の合格提出でカウント。閲覧レポートと
   集計仕様が一致する。SECURITY INVOKER 維持で RLS バイパス無し。';

-- ============================================================
-- 2) get_my_subordinate_progress RPC
-- ============================================================
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
    /* compliance: 187 のまま (公開 + 現バージョン ack) */
    (SELECT count(*) FROM public.compliance_acknowledgments ca
       JOIN public.compliance_documents cd ON cd.id = ca.compliance_document_id
       WHERE ca.employee_id = te.emp_id
         AND cd.is_published = true
         AND ca.document_updated_at = cd.updated_at),
    /* trainings: 公開 + 現 recert 版の合格提出 (189) */
    (SELECT count(*) FROM public.trainings t
       WHERE t.is_published = true
         AND t.tenant_id = te.emp_tenant_id
         AND EXISTS (
           SELECT 1 FROM public.training_submissions ts
           WHERE ts.training_id = t.id
             AND ts.employee_id = te.emp_id
             AND ts.result = 'passed'
             AND ts.submitted_at >= t.recert_at
         )),
    /* announcements: 公開 + 現版 view_log (189) */
    (SELECT count(*) FROM public.announcements a
       WHERE a.is_published = true
         AND a.tenant_id = te.emp_tenant_id
         AND EXISTS (
           SELECT 1 FROM public.announcement_view_logs avl
           WHERE avl.item_id = a.id
             AND avl.employee_id = te.emp_id
             AND avl.viewed_at >= a.updated_at
         )),
    /* manuals: 公開 + 現版 view_log (189) */
    (SELECT count(*) FROM public.manuals m
       WHERE m.is_published = true
         AND m.tenant_id = te.emp_tenant_id
         AND EXISTS (
           SELECT 1 FROM public.manual_view_logs mvl
           WHERE mvl.item_id = m.id
             AND mvl.employee_id = te.emp_id
             AND mvl.viewed_at >= m.updated_at
         )),
    (SELECT max(ds.submitted_at) FROM public.document_submissions ds
       WHERE ds.employee_id = te.emp_id AND ds.status = 'submitted'),
    (SELECT max(ca.acknowledged_at) FROM public.compliance_acknowledgments ca
       JOIN public.compliance_documents cd ON cd.id = ca.compliance_document_id
       WHERE ca.employee_id = te.emp_id
         AND cd.is_published = true
         AND ca.document_updated_at = cd.updated_at),
    /* last_training_at: 現 recert 版の合格提出のうち最新 */
    (SELECT max(ts.submitted_at) FROM public.training_submissions ts
       JOIN public.trainings t ON t.id = ts.training_id
       WHERE ts.employee_id = te.emp_id
         AND ts.result = 'passed'
         AND t.is_published = true
         AND ts.submitted_at >= t.recert_at),
    /* last_announcement_at: 現版 view_log のうち最新 */
    (SELECT max(avl.viewed_at) FROM public.announcement_view_logs avl
       JOIN public.announcements a ON a.id = avl.item_id
       WHERE avl.employee_id = te.emp_id
         AND a.is_published = true
         AND avl.viewed_at >= a.updated_at),
    /* last_manual_at: 現版 view_log のうち最新 */
    (SELECT max(mvl.viewed_at) FROM public.manual_view_logs mvl
       JOIN public.manuals m ON m.id = mvl.item_id
       WHERE mvl.employee_id = te.emp_id
         AND m.is_published = true
         AND mvl.viewed_at >= m.updated_at),
    te.emp_position_id,
    COALESCE(eaf.additional_facilities, ARRAY[]::uuid[])
  FROM target_emps te
  LEFT JOIN emp_additional_facilities eaf ON eaf.emp_id = te.emp_id
  ORDER BY te.emp_last_name, te.emp_first_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

GRANT EXECUTE ON FUNCTION public.get_my_subordinate_progress(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_subordinate_progress(uuid) IS
  '189: 187 に加え、announcements/manuals を現版 view_log、trainings を現 recert
   版の合格提出でカウント。employee_progress view (189) と集計仕様が完全一致。
   RETURNS TABLE 構造は 183/187 と同一のため client 側変更不要。';

NOTIFY pgrst, 'reload schema';
