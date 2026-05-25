-- 205: カテゴリに facility audience を追加 (4 機能 audience と同じ構造)
--
-- 仕様: docs/features/category-audience.md (ORIGAMI 側 SSOT)
-- diletto migration 195 / ORIGAMI migration 225 と同義 (schema 差のみ)。

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'all'
    CHECK (target_type IN ('all', 'facility'));
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS target_facility_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_tenant_select ON public.categories;
DROP POLICY IF EXISTS categories_admin_manage ON public.categories;
DROP POLICY IF EXISTS categories_manager_manage ON public.categories;
DROP POLICY IF EXISTS categories_select_visible ON public.categories;

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

CREATE POLICY categories_manager_manage ON public.categories
  FOR ALL
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() = 'manager'
    AND target_type = 'facility'
    AND target_facility_ids && (
      SELECT array_agg(fid) FROM public.get_my_facility_ids() AS fid
    )
  )
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() = 'manager'
    AND target_type = 'facility'
    AND target_facility_ids <@ (
      SELECT array_agg(fid) FROM public.get_my_facility_ids() AS fid
    )
  );

COMMENT ON COLUMN public.categories.target_type IS '205: 配信対象タイプ';
COMMENT ON COLUMN public.categories.target_facility_ids IS '205: 配信対象 facility';
COMMENT ON COLUMN public.categories.created_by IS '205: 作成者';
