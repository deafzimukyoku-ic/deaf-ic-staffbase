-- 190: employee_progress view + get_my_subordinate_progress RPC の達成数(分子)に
--      audience(配信対象)フィルタを追加し、ダッシュボード分母・閲覧レポートと一致させる
--
-- 真因 (root-cause-fix で特定):
-- 185/187/189 まで、分子 (compliance_done / trainings_passed / announcements_read /
-- manuals_read) は is_published + tenant 一致 + 版/合格条件 だけで数え、「そのアイテムが
-- その社員の配信対象 (audience) か」を見ていなかった。一方ダッシュボードの分母
-- (publishedTotalsByEmployee) と閲覧レポート (ReportMatrix) は lib/multi-facility.ts の
-- isItemInAudience で audience フィルタ済み。この非対称により、社員が「配信対象外だが
-- 過去に閲覧した」アイテムを持つと 分子 > 分母 となり、進捗バッジが「3/2」等の分母超えを
-- 起こす。
--   実確認 (deaf-ic 本番): 事業所「🎨パレット」の 3 名 (岸部/禹/鈴木) で
--   announcements_read=3 / audience内=2。3 件目は別事業所宛の「おもちゃの消毒」
--   (target_type='facility', 対象=別 facility) を過去に閲覧した view_log。
--
-- 修正:
-- audience 判定を SQL 関数 item_in_audience() に集約 (再発防止: 判定を 1 ヶ所に)。
-- view / RPC の 4 カテゴリ分子 + last_*_at をすべて audience フィルタする。
-- item_in_audience は lib/multi-facility.ts::isItemInAudience と同一ロジック。両者は
-- 常に同義に保つこと (どちらかを変えたら他方も変える)。
--
-- 列構造は 189 と完全同一 (view 8 列 / RPC RETURNS TABLE 20 列)。ダッシュボード UI
-- (ProgressDashboard.tsx / mgr|admin/dashboard) は無変更で動く。

-- ============================================================
-- 0) audience 判定ヘルパー (lib/multi-facility.ts::isItemInAudience の SQL 版)
-- ============================================================
CREATE OR REPLACE FUNCTION public.item_in_audience(
  p_target_type         text,
  p_target_facility_ids uuid[],
  p_target_position_ids uuid[],
  p_emp_facility_ids    uuid[],
  p_emp_position_id     uuid
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT
    (
      p_target_type = 'all'
      OR (
        p_target_type = 'facility'
        AND p_target_facility_ids IS NOT NULL
        AND p_target_facility_ids && p_emp_facility_ids
      )
    )
    AND (
      p_target_position_ids IS NULL
      OR cardinality(p_target_position_ids) = 0
      OR (p_emp_position_id IS NOT NULL AND p_emp_position_id = ANY(p_target_position_ids))
    );
$$;

COMMENT ON FUNCTION public.item_in_audience(text, uuid[], uuid[], uuid[], uuid) IS
  '190: 4機能アイテムの配信対象判定。lib/multi-facility.ts::isItemInAudience と同一ロジック。
   target_type=all は全員対象、facility は対象施設配列が社員所属(主+兼任)と交差すれば対象。
   target_position_ids 指定時は社員 position_id も AND で一致が必要。';

-- ============================================================
-- 1) employee_progress view (audience フィルタ込み)
-- ============================================================
DROP VIEW IF EXISTS employee_progress;

CREATE VIEW employee_progress
WITH (security_invoker = true)
AS
  WITH emp_aud AS (
    SELECT
      e.id,
      e.tenant_id,
      e.facility_id,
      e.position_id,
      /* audience 判定用: 主所属 + 兼任(employee_facilities) を 1 配列に */
      CASE
        WHEN e.facility_id IS NULL
          THEN COALESCE(
                 (SELECT array_agg(ef.facility_id) FROM employee_facilities ef
                   WHERE ef.employee_id = e.id),
                 ARRAY[]::uuid[])
        ELSE e.facility_id || COALESCE(
                 (SELECT array_agg(ef.facility_id) FROM employee_facilities ef
                   WHERE ef.employee_id = e.id),
                 ARRAY[]::uuid[])
      END AS fac_ids
    FROM employees e
  )
  SELECT
    ea.id AS employee_id,
    ea.tenant_id,
    ea.facility_id,
    (SELECT count(*) FROM document_submissions ds
      WHERE ds.employee_id = ea.id AND ds.status = 'submitted') AS docs_submitted,

    /* compliance: 公開中 + 現バージョン ack + 配信対象内 */
    (SELECT count(*) FROM compliance_acknowledgments ca
      JOIN compliance_documents cd ON cd.id = ca.compliance_document_id
      WHERE ca.employee_id = ea.id
        AND cd.is_published = true
        AND ca.document_updated_at = cd.updated_at
        AND public.item_in_audience(cd.target_type, cd.target_facility_ids,
              cd.target_position_ids, ea.fac_ids, ea.position_id)) AS compliance_done,

    /* trainings: 公開中 + 現 recert 版の合格提出 + 配信対象内 */
    (SELECT count(*) FROM trainings t
      WHERE t.is_published = true
        AND t.tenant_id = ea.tenant_id
        AND public.item_in_audience(t.target_type, t.target_facility_ids,
              t.target_position_ids, ea.fac_ids, ea.position_id)
        AND EXISTS (
          SELECT 1 FROM training_submissions ts
          WHERE ts.training_id = t.id
            AND ts.employee_id = ea.id
            AND ts.result = 'passed'
            AND ts.submitted_at >= t.recert_at
        )) AS trainings_passed,

    /* announcements: 公開中 + 現版閲覧 + 配信対象内 */
    (SELECT count(*) FROM announcements a
      WHERE a.is_published = true
        AND a.tenant_id = ea.tenant_id
        AND public.item_in_audience(a.target_type, a.target_facility_ids,
              a.target_position_ids, ea.fac_ids, ea.position_id)
        AND EXISTS (
          SELECT 1 FROM announcement_view_logs avl
          WHERE avl.item_id = a.id
            AND avl.employee_id = ea.id
            AND avl.viewed_at >= a.updated_at
        )) AS announcements_read,

    /* manuals: 公開中 + 現版閲覧 + 配信対象内 */
    (SELECT count(*) FROM manuals m
      WHERE m.is_published = true
        AND m.tenant_id = ea.tenant_id
        AND public.item_in_audience(m.target_type, m.target_facility_ids,
              m.target_position_ids, ea.fac_ids, ea.position_id)
        AND EXISTS (
          SELECT 1 FROM manual_view_logs mvl
          WHERE mvl.item_id = m.id
            AND mvl.employee_id = ea.id
            AND mvl.viewed_at >= m.updated_at
        )) AS manuals_read
  FROM emp_aud ea;

COMMENT ON VIEW employee_progress IS
  '190: 189 に audience フィルタ(item_in_audience)を追加。4機能の達成数(分子)を社員の
   配信対象アイテムに限定し、ダッシュボード分母・閲覧レポートと完全一致させる。
   SECURITY INVOKER 維持。列構造は 185/189 と同一。';

-- ============================================================
-- 2) get_my_subordinate_progress RPC (audience フィルタ込み)
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
  ),
  emp_full AS (
    SELECT
      te.*,
      COALESCE(eaf.additional_facilities, ARRAY[]::uuid[]) AS add_facs,
      /* audience 判定用: 主所属 + 兼任 を 1 配列に */
      CASE
        WHEN te.emp_facility_id IS NULL
          THEN COALESCE(eaf.additional_facilities, ARRAY[]::uuid[])
        ELSE te.emp_facility_id || COALESCE(eaf.additional_facilities, ARRAY[]::uuid[])
      END AS emp_fac_ids
    FROM target_emps te
    LEFT JOIN emp_additional_facilities eaf ON eaf.emp_id = te.emp_id
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
    /* compliance: 公開 + 現バージョン ack + 配信対象内 */
    (SELECT count(*) FROM public.compliance_acknowledgments ca
       JOIN public.compliance_documents cd ON cd.id = ca.compliance_document_id
       WHERE ca.employee_id = te.emp_id
         AND cd.is_published = true
         AND ca.document_updated_at = cd.updated_at
         AND public.item_in_audience(cd.target_type, cd.target_facility_ids,
               cd.target_position_ids, te.emp_fac_ids, te.emp_position_id)),
    /* trainings: 公開 + 現 recert 版の合格提出 + 配信対象内 */
    (SELECT count(*) FROM public.trainings t
       WHERE t.is_published = true
         AND t.tenant_id = te.emp_tenant_id
         AND public.item_in_audience(t.target_type, t.target_facility_ids,
               t.target_position_ids, te.emp_fac_ids, te.emp_position_id)
         AND EXISTS (
           SELECT 1 FROM public.training_submissions ts
           WHERE ts.training_id = t.id
             AND ts.employee_id = te.emp_id
             AND ts.result = 'passed'
             AND ts.submitted_at >= t.recert_at
         )),
    /* announcements: 公開 + 現版 view_log + 配信対象内 */
    (SELECT count(*) FROM public.announcements a
       WHERE a.is_published = true
         AND a.tenant_id = te.emp_tenant_id
         AND public.item_in_audience(a.target_type, a.target_facility_ids,
               a.target_position_ids, te.emp_fac_ids, te.emp_position_id)
         AND EXISTS (
           SELECT 1 FROM public.announcement_view_logs avl
           WHERE avl.item_id = a.id
             AND avl.employee_id = te.emp_id
             AND avl.viewed_at >= a.updated_at
         )),
    /* manuals: 公開 + 現版 view_log + 配信対象内 */
    (SELECT count(*) FROM public.manuals m
       WHERE m.is_published = true
         AND m.tenant_id = te.emp_tenant_id
         AND public.item_in_audience(m.target_type, m.target_facility_ids,
               m.target_position_ids, te.emp_fac_ids, te.emp_position_id)
         AND EXISTS (
           SELECT 1 FROM public.manual_view_logs mvl
           WHERE mvl.item_id = m.id
             AND mvl.employee_id = te.emp_id
             AND mvl.viewed_at >= m.updated_at
         )),
    (SELECT max(ds.submitted_at) FROM public.document_submissions ds
       WHERE ds.employee_id = te.emp_id AND ds.status = 'submitted'),
    /* last_compliance_at: 現バージョン ack + 配信対象内 のうち最新 */
    (SELECT max(ca.acknowledged_at) FROM public.compliance_acknowledgments ca
       JOIN public.compliance_documents cd ON cd.id = ca.compliance_document_id
       WHERE ca.employee_id = te.emp_id
         AND cd.is_published = true
         AND ca.document_updated_at = cd.updated_at
         AND public.item_in_audience(cd.target_type, cd.target_facility_ids,
               cd.target_position_ids, te.emp_fac_ids, te.emp_position_id)),
    /* last_training_at: 現 recert 版の合格提出 + 配信対象内 のうち最新 */
    (SELECT max(ts.submitted_at) FROM public.training_submissions ts
       JOIN public.trainings t ON t.id = ts.training_id
       WHERE ts.employee_id = te.emp_id
         AND ts.result = 'passed'
         AND t.is_published = true
         AND ts.submitted_at >= t.recert_at
         AND public.item_in_audience(t.target_type, t.target_facility_ids,
               t.target_position_ids, te.emp_fac_ids, te.emp_position_id)),
    /* last_announcement_at: 現版 view_log + 配信対象内 のうち最新 */
    (SELECT max(avl.viewed_at) FROM public.announcement_view_logs avl
       JOIN public.announcements a ON a.id = avl.item_id
       WHERE avl.employee_id = te.emp_id
         AND a.is_published = true
         AND avl.viewed_at >= a.updated_at
         AND public.item_in_audience(a.target_type, a.target_facility_ids,
               a.target_position_ids, te.emp_fac_ids, te.emp_position_id)),
    /* last_manual_at: 現版 view_log + 配信対象内 のうち最新 */
    (SELECT max(mvl.viewed_at) FROM public.manual_view_logs mvl
       JOIN public.manuals m ON m.id = mvl.item_id
       WHERE mvl.employee_id = te.emp_id
         AND m.is_published = true
         AND mvl.viewed_at >= m.updated_at
         AND public.item_in_audience(m.target_type, m.target_facility_ids,
               m.target_position_ids, te.emp_fac_ids, te.emp_position_id)),
    te.emp_position_id,
    te.add_facs
  FROM emp_full te
  ORDER BY te.emp_last_name, te.emp_first_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

GRANT EXECUTE ON FUNCTION public.get_my_subordinate_progress(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_subordinate_progress(uuid) IS
  '190: 189 に audience フィルタ(item_in_audience)を追加。4機能の分子と last_*_at を
   社員の配信対象アイテムに限定し、employee_progress view (190)・閲覧レポートと完全一致。
   RETURNS TABLE 構造は 183/187/189 と同一のため client 変更不要。';

NOTIFY pgrst, 'reload schema';
