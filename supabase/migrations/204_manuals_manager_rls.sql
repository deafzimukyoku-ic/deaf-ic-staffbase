-- 204: manuals に manager 用 RLS ポリシーを追加
--
-- 真因 (root-cause-fix):
-- 他 3 機能 (announcements / compliance_documents / trainings) には
-- manager_edit_own_* / manager_manage_* の ALL ポリシーがあり manager が
-- INSERT/UPDATE/DELETE できる設計だが、manuals だけ admin can manage 1 本
-- (admin only) しか管理用ポリシーが無く、manager は何もできない。
-- これにより mgr/manuals 画面で投稿しようとすると PostgreSQL の RLS で 42501
-- (new row violates row-level security policy for table "manuals") が出る。
-- diletto migration 194 と同一内容。
--
-- 修正:
-- 他 3 機能と同じ 2 本のポリシーを manuals に追加。

DROP POLICY IF EXISTS manager_edit_own_manuals ON public.manuals;
CREATE POLICY manager_edit_own_manuals ON public.manuals FOR ALL
USING (
  (get_my_role() = 'manager')
  AND (created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1))
);

DROP POLICY IF EXISTS manager_manage_manuals ON public.manuals;
CREATE POLICY manager_manage_manuals ON public.manuals FOR ALL
USING (
  (get_my_role() = 'manager')
  AND (target_facility_ids && (
    SELECT array_agg(combined_facilities.id)
    FROM (
      SELECT employees.facility_id AS id FROM employees
       WHERE employees.auth_user_id = auth.uid()
         AND employees.facility_id IS NOT NULL
      UNION
      SELECT manager_facilities.facility_id AS id FROM manager_facilities
       WHERE manager_facilities.employee_id = (
         SELECT employees.id FROM employees
          WHERE employees.auth_user_id = auth.uid() LIMIT 1
       )
    ) combined_facilities
  ))
);

COMMENT ON POLICY manager_edit_own_manuals ON public.manuals IS
  '204: manager が自身で作成した manuals を全操作可。announcements と同じ構造。';
COMMENT ON POLICY manager_manage_manuals ON public.manuals IS
  '204: manager が自身の管理 facility (employees.facility_id ∪ manager_facilities) 配信の
   manuals を全操作可。target_facility_ids との交差で判定。announcements と同じ構造。';
