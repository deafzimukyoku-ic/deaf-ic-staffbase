-- 037_notification_queue.sql
-- 遵守事項・研修・お知らせの作成/編集から2時間後に社員へメール送信するためのキュー
-- 編集時はUPDATEでscheduled_atリセット（新規投稿扱い）
-- 削除時はcancelled_atセット

CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('announcement', 'compliance', 'training')),
  content_id UUID NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  -- enqueue時の投稿者。flush時にこの社員は宛先から除外
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cronの対象取得用（未送信・未キャンセル・時刻到達）
CREATE INDEX IF NOT EXISTS idx_notification_queue_ready
  ON notification_queue (scheduled_at)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- 同一コンテンツで未送信キューは常に1つだけ（編集時UPDATEを強制）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notification_queue_active_content
  ON notification_queue (content_type, content_id)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- RLS: adminとmanagerのみ自テナント分を操作可能、社員は不可、cronはservice roleでbypass
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_queue_admin_manager_all ON notification_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.auth_user_id = auth.uid()
        AND employees.tenant_id = notification_queue.tenant_id
        AND employees.role IN ('admin', 'super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.auth_user_id = auth.uid()
        AND employees.tenant_id = notification_queue.tenant_id
        AND employees.role IN ('admin', 'super_admin', 'manager')
    )
  );
