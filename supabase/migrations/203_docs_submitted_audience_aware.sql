-- 203: employee_progress.docs_submitted に書類テンプレ audience フィルタを追加
--
-- 真因 (root-cause-fix):
-- migration 190 で 4 機能 (compliance/training/announcement/manual) の分子に
-- item_in_audience() を入れたが、docs_submitted (書類提出数) だけ漏れていた。
-- ダッシュボード分母 docTotalsByEmployee は client 側 isEmployeeInAudience で
-- document_template_audience の rule を照合して per-employee に絞っているのに、
-- view の分子は素の document_submissions 全件 count で audience 無視。
-- 過去の has_car_commute=true 時代に提出した書類が、フラグ false に変わった後も
-- 分子に残り、分母から消える → 「7/6」など分子>分母が発生。
--   実確認 (deaf-ic 本番): docs_submitted 上位 5 名が 8/9 〜 7/9（テナント全テンプレ 9）。
--   実際のダッシュボード分母は per-employee なので 9 より少ない社員が多く、表記破綻。
--
-- 修正:
-- (1) document_template_in_audience(template_id, employee_id) SQL 関数を新設。
--     lib/template-audience.ts::isEmployeeInAudience と同一ロジック:
--       - audience rule 0 件 = 全員対象 (true)
--       - rule あり = いずれかにマッチ (OR)
--         * rule_type='employee'  → employee.id 一致
--         * rule_type='facility'  → employee.facility_id 一致
--         * rule_type='role'      → employee.role 一致
--         * rule_type='flag'      → employee.{has_car_commute|is_shuttle_driver} = true
-- (2) employee_progress view を再作成、docs_submitted を audience-aware に。
--
-- 列構造・他の分子・get_my_subordinate_progress RPC は無変更。
-- 190 の item_in_audience() と命名揃え (item_*  vs document_template_*)。

-- ============================================================
-- 1) 書類テンプレ audience 判定ヘルパー
-- ============================================================
CREATE OR REPLACE FUNCTION public.document_template_in_audience(
  p_template_id uuid,
  p_employee_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  /* rule 0 件なら全員対象。rule あり時は OR でいずれかマッチ。 */
  SELECT
    NOT EXISTS (
      SELECT 1 FROM document_template_audience WHERE template_id = p_template_id
    )
    OR EXISTS (
      SELECT 1
        FROM document_template_audience dta
        JOIN employees e ON e.id = p_employee_id
       WHERE dta.template_id = p_template_id
         AND (
              (dta.rule_type = 'employee' AND dta.rule_value = e.id::text)
           OR (dta.rule_type = 'facility' AND dta.rule_value = e.facility_id::text)
           OR (dta.rule_type = 'role'     AND dta.rule_value = e.role)
           OR (dta.rule_type = 'flag'     AND dta.rule_value = 'has_car_commute'  AND e.has_car_commute  = true)
           OR (dta.rule_type = 'flag'     AND dta.rule_value = 'is_shuttle_driver' AND e.is_shuttle_driver = true)
         )
    );
$$;

COMMENT ON FUNCTION public.document_template_in_audience(uuid, uuid) IS
  '203: 書類テンプレ配布対象判定。lib/template-audience.ts::isEmployeeInAudience と同一ロジック。
   rule 0 件 = 全員対象、rule あり時は employee/facility/role/flag のいずれかマッチで対象。
   FLAG_OPTIONS (has_car_commute / is_shuttle_driver) と同期。新規フラグ追加時は本関数も更新。';

-- ============================================================
-- 2) employee_progress view 再作成 (docs_submitted のみ修正)
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

    /* docs_submitted: 提出済 + テンプレが現時点の audience 内 (203 修正) */
    (SELECT count(*) FROM document_submissions ds
      JOIN document_templates dt ON dt.id = ds.document_template_id
      WHERE ds.employee_id = ea.id
        AND ds.status = 'submitted'
        AND dt.tenant_id = ea.tenant_id
        AND public.document_template_in_audience(dt.id, ea.id)) AS docs_submitted,

    /* compliance: 公開中 + 現バージョン ack + 配信対象内 (190) */
    (SELECT count(*) FROM compliance_acknowledgments ca
      JOIN compliance_documents cd ON cd.id = ca.compliance_document_id
      WHERE ca.employee_id = ea.id
        AND cd.is_published = true
        AND ca.document_updated_at = cd.updated_at
        AND public.item_in_audience(cd.target_type, cd.target_facility_ids,
              cd.target_position_ids, ea.fac_ids, ea.position_id)) AS compliance_done,

    /* trainings: 公開中 + 現 recert 版の合格提出 + 配信対象内 (190) */
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

    /* announcements: 公開中 + 現版閲覧 + 配信対象内 (190) */
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

    /* manuals: 公開中 + 現版閲覧 + 配信対象内 (190) */
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
  '203: 190 に追加で docs_submitted を audience-aware 化。書類は document_template_audience
   テーブルで rule (flag/facility/role/employee) を持つため document_template_in_audience()
   で判定。190 同様 SECURITY INVOKER 維持・列構造 8 列維持。';
