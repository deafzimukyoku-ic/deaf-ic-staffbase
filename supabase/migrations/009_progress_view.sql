-- 009: employee_progress ビュー
create view employee_progress as
  select
    e.id as employee_id,
    e.tenant_id,
    (select count(*) from document_submissions ds
      where ds.employee_id = e.id and ds.status = 'submitted') as docs_submitted,
    (select count(*) from compliance_acknowledgments ca
      where ca.employee_id = e.id) as compliance_done,
    (select count(*) from training_submissions ts
      where ts.employee_id = e.id and ts.result = 'passed') as trainings_passed,
    (select count(*) from announcement_reads ar
      where ar.employee_id = e.id) as announcements_read
  from employees e;
