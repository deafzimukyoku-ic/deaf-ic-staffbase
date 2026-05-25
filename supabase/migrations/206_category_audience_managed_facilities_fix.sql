-- 206: categories RLS で manager_facilities (管轄事業所兼任) を考慮する
--
-- 真因 (root-cause-fix):
-- 205 で追加した categories の RLS ポリシー 3 本のうち、manager 関連の判定が
-- public.get_my_facility_ids() を使っていた。130_employee_facilities.sql の定義により
-- get_my_facility_ids() = employees.facility_id ∪ employee_facilities (兼任先)
-- であり、manager_facilities (管轄事業所) を**含まない**。
--
-- 結果として、主所属 facility A の manager が manager_facilities に facility B を
-- 持って B のカテゴリを作成・編集しようとしても WITH CHECK で蹴られる
-- (CREATE で 42501 / UPDATE で行が更新されない silent fail)。
--
-- 修正:
-- - manager 用判定を get_my_managed_facility_ids() (130 で定義済: primary ∪ manager_facilities) に差し替え
-- - SELECT 用は「自分が見られる」ものを広く取りたい意図なので兼任先も含むよう
--   primary ∪ manager_facilities ∪ employee_facilities の union を用いる
-- - 併せて 204 で USING のみだった manuals.manager_manage_manuals に
--   同じ式の WITH CHECK を明示 (他機能と同形に揃える)
--
-- diletto 196 と同等内容。

BEGIN;

-- ============================================================
-- 1. categories のポリシーを drop して張り直し
-- ============================================================

DROP POLICY IF EXISTS categories_select_visible ON public.categories;
DROP POLICY IF EXISTS categories_admin_manage ON public.categories;
DROP POLICY IF EXISTS categories_manager_manage ON public.categories;

-- SELECT: 全社員が「自分宛て」のカテゴリを見られる
--   admin/super_admin/manager は全件
--   employee は target_type='all' か、target_facility_ids が自分の所属(primary + 兼任) と交差
CREATE POLICY categories_select_visible ON public.categories
  FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND (
      target_type = 'all'
      OR public.get_my_role() IN ('admin', 'super_admin', 'manager')
      OR target_facility_ids && (
        SELECT array_agg(fid) FROM public.get_my_facility_ids() AS fid
      )
    )
  );

-- ALL (admin/super_admin): 同テナント内のカテゴリを全操作可
CREATE POLICY categories_admin_manage ON public.categories
  FOR ALL
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() IN ('admin', 'super_admin')
  );

-- ALL (manager): 自分が管轄する事業所 (primary ∪ manager_facilities) 配信のカテゴリを全操作可
-- USING は && (交差) で「触れる」、WITH CHECK は <@ (部分集合) で「全部自分の管轄に収まる」のみ通す
CREATE POLICY categories_manager_manage ON public.categories
  FOR ALL
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() = 'manager'
    AND target_type = 'facility'
    AND target_facility_ids && (
      SELECT array_agg(fid) FROM public.get_my_managed_facility_ids() AS fid
    )
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() = 'manager'
    AND target_type = 'facility'
    AND target_facility_ids <@ (
      SELECT array_agg(fid) FROM public.get_my_managed_facility_ids() AS fid
    )
  );

COMMENT ON POLICY categories_manager_manage ON public.categories IS
  '206: manager が自管轄 facility (primary ∪ manager_facilities) 向けカテゴリを全操作可。205 では get_my_facility_ids() を使っていたが manager_facilities を含まず誤判定。get_my_managed_facility_ids() に差し替え。';

-- ============================================================
-- 2. manuals.manager_manage_manuals に WITH CHECK を明示 (204 漏れ補完)
-- ============================================================

-- 204 では USING のみで WITH CHECK が省略されていた。
-- PostgreSQL の挙動上 ALL ポリシーで WITH CHECK 省略時は USING と同じ式が適用されるが、
-- 他機能 (announcements / compliance_documents / trainings) と形を揃え、
-- 意図を明示するために WITH CHECK も書く。

DROP POLICY IF EXISTS manager_manage_manuals ON public.manuals;
CREATE POLICY manager_manage_manuals ON public.manuals
  FOR ALL
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
  )
  WITH CHECK (
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

COMMENT ON POLICY manager_manage_manuals ON public.manuals IS
  '206: 204 で USING のみだったため WITH CHECK を明示。manager が自管理 facility (employees.facility_id ∪ manager_facilities) 配信の manuals を全操作可。announcements と同じ構造。';

COMMIT;

NOTIFY pgrst, 'reload schema';
