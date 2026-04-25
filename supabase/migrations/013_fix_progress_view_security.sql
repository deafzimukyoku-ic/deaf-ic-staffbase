-- 013: employee_progress ビューを SECURITY INVOKER に変更
-- Supabase Linter: security_definer_view 対応
-- INVOKER にすることでクエリ実行ユーザーのRLSポリシーが適用される

DROP VIEW IF EXISTS employee_progress;

CREATE VIEW employee_progress
WITH (security_invoker = true)
AS
  SELECT
    e.id AS employee_id,
    e.tenant_id,
    (SELECT count(*) FROM document_submissions ds
      WHERE ds.employee_id = e.id AND ds.status = 'submitted') AS docs_submitted,
    (SELECT count(*) FROM compliance_acknowledgments ca
      WHERE ca.employee_id = e.id) AS compliance_done,
    (SELECT count(*) FROM training_submissions ts
      WHERE ts.employee_id = e.id AND ts.result = 'passed') AS trainings_passed,
    (SELECT count(*) FROM announcement_reads ar
      WHERE ar.employee_id = e.id) AS announcements_read
  FROM employees e;
