-- 144: manager が自管轄施設の社員を SELECT できるよう RLS 追加
--
-- 背景:
-- /mgr/subordinates が誰も表示されない原因は、employees テーブルの SELECT RLS が
-- 「自分自身」と「admin/super_admin」しか許していなかったため。
-- manager は manager_facilities (兼務含む) で割り当てられた施設の社員を
-- 業務上閲覧する必要がある。
--
-- 設計:
-- - migration 130 で既に存在する get_my_managed_facility_ids() を活用
--   （戻り値 setof uuid。primary facility_id ∪ manager_facilities）
-- - その施設に所属（primary または employee_facilities 兼務）する社員を SELECT 可
-- - shift_manager にも同じ範囲を許可（シフト統括ロール / Phase C 由来）

DROP POLICY IF EXISTS "manager can read subordinate employees" ON public.employees;
CREATE POLICY "manager can read subordinate employees"
  ON public.employees FOR SELECT
  USING (
    /* 同テナント */
    tenant_id = get_my_tenant_id()
    /* manager / shift_manager にのみ適用（admin は別ポリシーで許可済） */
    AND get_my_role() IN ('manager', 'shift_manager')
    AND (
      /* 主所属施設が自管轄 */
      (facility_id IS NOT NULL AND facility_id IN (SELECT get_my_managed_facility_ids()))
      OR
      /* 兼務先施設のいずれかが自管轄（migration 130 の employee_facilities） */
      EXISTS (
        SELECT 1 FROM public.employee_facilities ef
        WHERE ef.employee_id = public.employees.id
          AND ef.facility_id IN (SELECT get_my_managed_facility_ids())
      )
    )
  );
