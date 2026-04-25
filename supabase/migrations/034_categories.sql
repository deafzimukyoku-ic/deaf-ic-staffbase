-- 034: カテゴリ機能（遵守事項・研修・お知らせ共通）
-- 本ファイルは既に本番に適用済み。他環境での再適用に備え IF NOT EXISTS ガードを付与。

CREATE TABLE IF NOT EXISTS categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null check (type in ('compliance','training','announcement')),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, type, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant_type ON categories(tenant_id, type);

-- 使用中カテゴリは削除できない（RESTRICT）。テナント側でレコード整理してから削除する前提。
ALTER TABLE compliance_documents
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE trainings
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_compliance_documents_category ON compliance_documents(category_id);
CREATE INDEX IF NOT EXISTS idx_trainings_category ON trainings(category_id);
CREATE INDEX IF NOT EXISTS idx_announcements_category ON announcements(category_id);
