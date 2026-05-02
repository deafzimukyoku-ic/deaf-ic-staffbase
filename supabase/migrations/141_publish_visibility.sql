-- Phase E-2: 4 機能（announcements / compliance_documents / trainings / manuals）に
-- 公開/非公開フラグ is_published を追加。
--
-- 既存データはデフォルト TRUE（公開）。employee 側 SELECT 用 RLS を
-- is_published=true もしくは admin/manager のみ可に変更（admin/manager は下書きも見える）。
--
-- ※ 既存の "admin can manage X" / manager 系ポリシーは別ポリシーなので影響なし。

-- 1. カラム追加（IF NOT EXISTS で再実行安全）
ALTER TABLE announcements         ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE compliance_documents  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE trainings             ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE manuals               ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. 既存 SELECT ポリシーを差し替え
--    employee は is_published=true のみ閲覧可、admin/manager は全件閲覧可。

-- announcements
DROP POLICY IF EXISTS "tenant members can read announcements" ON announcements;
CREATE POLICY "tenant members can read announcements"
  ON announcements FOR SELECT
  USING (
    tenant_id = get_my_tenant_id()
    AND (is_published = TRUE OR get_my_role() IN ('admin', 'manager'))
  );

-- compliance_documents
DROP POLICY IF EXISTS "tenant members can read compliance" ON compliance_documents;
CREATE POLICY "tenant members can read compliance"
  ON compliance_documents FOR SELECT
  USING (
    tenant_id = get_my_tenant_id()
    AND (is_published = TRUE OR get_my_role() IN ('admin', 'manager'))
  );

-- trainings
DROP POLICY IF EXISTS "tenant members can read trainings" ON trainings;
CREATE POLICY "tenant members can read trainings"
  ON trainings FOR SELECT
  USING (
    tenant_id = get_my_tenant_id()
    AND (is_published = TRUE OR get_my_role() IN ('admin', 'manager'))
  );

-- manuals
DROP POLICY IF EXISTS "tenant members can read manuals" ON manuals;
CREATE POLICY "tenant members can read manuals"
  ON manuals FOR SELECT
  USING (
    tenant_id = get_my_tenant_id()
    AND (is_published = TRUE OR get_my_role() IN ('admin', 'manager'))
  );
