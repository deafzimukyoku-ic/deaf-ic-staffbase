-- 110_employee_progress_manuals.sql
-- employee_progress ビューに manuals_read を追加
-- (migration 091 で manuals + manual_reads テーブル追加時に view 更新を漏らしていた)
-- migration 046 のスキーマ (facility_id カラム含む + SECURITY INVOKER) を維持して再作成
--
-- CREATE OR REPLACE VIEW では既存カラムの位置・名前を変更できないため、
-- DROP → CREATE のパターンを使用 (migration 046 と同じ手法)

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
    (SELECT count(*) FROM compliance_acknowledgments ca
      WHERE ca.employee_id = e.id) AS compliance_done,
    (SELECT count(*) FROM training_submissions ts
      WHERE ts.employee_id = e.id AND ts.result = 'passed') AS trainings_passed,
    (SELECT count(*) FROM announcement_reads ar
      WHERE ar.employee_id = e.id) AS announcements_read,
    (SELECT count(*) FROM manual_reads mr
      WHERE mr.employee_id = e.id) AS manuals_read
  FROM employees e;
