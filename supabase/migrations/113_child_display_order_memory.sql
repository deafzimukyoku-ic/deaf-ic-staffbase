-- 113_child_display_order_memory.sql
-- 送迎表 / 日次出力カードの「児童 DnD 並び順」の学習記憶用テーブル
-- shift-puzzle の child_display_order_memory を deaf-ic 化（facility_id 追加）

CREATE TABLE public.child_display_order_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  slot_signature text NOT NULL,
  child_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  display_order integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, facility_id, slot_signature, child_id)
);

CREATE INDEX idx_cdom_tenant_facility ON public.child_display_order_memory(tenant_id, facility_id);
CREATE INDEX idx_cdom_signature ON public.child_display_order_memory(tenant_id, facility_id, slot_signature);

ALTER TABLE public.child_display_order_memory ENABLE ROW LEVEL SECURITY;

-- admin / manager（自 facility のみ）
CREATE POLICY cdom_admin_mgr_all ON public.child_display_order_memory FOR ALL TO authenticated
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
