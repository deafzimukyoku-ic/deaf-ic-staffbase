-- 112_transport_assignments_array.sql
-- transport_assignments を shift-puzzle 互換の配列スキーマに置換
-- 1 entry = 1 行（pickup/dropoff 両方の担当者を配列で保持、最大2名想定）
--
-- 元スキーマ（migration 100）は 1 entry × 1 方向 = 1 行で employee_id がスカラー、
-- (entry, direction) が unique という制約により「最大2名」仕様を満たせなかったため、
-- shift-puzzle 互換の配列スキーマに置換する。
-- 既存データはテストデータのみで0件（事前確認済）のため drop & recreate で安全。

DROP TABLE IF EXISTS public.transport_assignments CASCADE;

CREATE TABLE public.transport_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  schedule_entry_id uuid NOT NULL REFERENCES public.schedule_entries(id) ON DELETE CASCADE,
  pickup_employee_ids uuid[] NOT NULL DEFAULT '{}',
  dropoff_employee_ids uuid[] NOT NULL DEFAULT '{}',
  is_confirmed boolean NOT NULL DEFAULT false,
  is_unassigned boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  publish_status publish_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, facility_id, schedule_entry_id)
);

CREATE INDEX idx_transport_assignments_tenant ON public.transport_assignments(tenant_id, facility_id);
CREATE INDEX idx_transport_assignments_entry ON public.transport_assignments(schedule_entry_id);
CREATE INDEX idx_transport_assignments_publish ON public.transport_assignments(tenant_id, facility_id, publish_status);
CREATE INDEX idx_transport_assignments_locked ON public.transport_assignments(tenant_id, facility_id, is_locked);

ALTER TABLE public.transport_assignments ENABLE ROW LEVEL SECURITY;

-- admin / manager（自 facility のみ）
CREATE POLICY ta_admin_mgr_all ON public.transport_assignments FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid())
    AND (
      (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'admin'
      OR (
        (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'manager'
        AND facility_id IN (
          SELECT facility_id FROM manager_facilities
          WHERE employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
          UNION
          SELECT facility_id FROM employees WHERE auth_user_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM employees WHERE auth_user_id = auth.uid())
  );

-- employee: ready/published かつ自分が含まれる行のみ SELECT
CREATE POLICY ta_employee_select ON public.transport_assignments FOR SELECT TO authenticated
  USING (
    publish_status IN ('ready', 'published')
    AND (
      (SELECT id FROM employees WHERE auth_user_id = auth.uid()) = ANY(pickup_employee_ids)
      OR (SELECT id FROM employees WHERE auth_user_id = auth.uid()) = ANY(dropoff_employee_ids)
    )
  );
