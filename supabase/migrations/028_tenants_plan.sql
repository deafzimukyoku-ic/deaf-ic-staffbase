-- テナントにプランカラムを追加
ALTER TABLE tenants
  ADD COLUMN plan text NOT NULL DEFAULT 'free'
  CONSTRAINT tenants_plan_check CHECK (plan IN ('free', 'standard', 'pro'));
