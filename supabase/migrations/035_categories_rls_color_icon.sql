-- 035: カテゴリに color / icon カラム追加 + RLS ポリシー
-- icon は絵文字1文字を想定（lucide-react バンドル増を避けるためテナント任意入力）
-- color はアプリ側のプリセット10色から選択（HEX文字列を保存）

-- ========== カラム追加 ==========
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6B7280';
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT '📁';

-- ========== RLS ==========
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーがあれば落としてから再作成（再適用安全性）
DROP POLICY IF EXISTS categories_tenant_select ON categories;
DROP POLICY IF EXISTS categories_admin_manage ON categories;
DROP POLICY IF EXISTS categories_manager_manage ON categories;

-- 社員・管理者・マネージャーとも自テナントのみ SELECT 可
CREATE POLICY categories_tenant_select ON categories
  FOR SELECT
  USING (tenant_id = get_my_tenant_id());

-- テナント管理者（admin / super_admin）は自テナントのカテゴリを全操作可
CREATE POLICY categories_admin_manage ON categories
  FOR ALL
  USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() IN ('admin', 'super_admin')
  );

-- マネージャーも自テナントのカテゴリを作成/編集可（研修・お知らせを作れる立場のため）
CREATE POLICY categories_manager_manage ON categories
  FOR ALL
  USING (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  )
  WITH CHECK (
    tenant_id = get_my_tenant_id()
    AND get_my_role() = 'manager'
  );
