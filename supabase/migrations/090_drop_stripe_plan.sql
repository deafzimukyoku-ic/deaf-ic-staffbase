-- deaf-ic 統合: Stripe / プラン / super_admin 削除
-- Phase 1: 課金不要 + ロール3段階化

-- 1. tenants から Stripe / プラン関連カラム削除
ALTER TABLE tenants
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_status,
  DROP COLUMN IF EXISTS plan;

-- 2. employees.role の CHECK 制約を 'admin' / 'manager' / 'employee' に制限
--    既存の super_admin を admin に昇格（データ保全）
UPDATE employees SET role = 'admin' WHERE role = 'super_admin';

-- 既存 CHECK 制約がある場合は削除して貼り直し
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'employees' AND constraint_name = 'employees_role_check'
  ) THEN
    ALTER TABLE employees DROP CONSTRAINT employees_role_check;
  END IF;
END $$;

ALTER TABLE employees
  ADD CONSTRAINT employees_role_check
  CHECK (role IN ('admin', 'manager', 'employee'));
