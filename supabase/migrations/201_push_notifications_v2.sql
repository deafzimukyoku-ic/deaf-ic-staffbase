-- 201: push-notifications-v2 基盤 — feature: docs/features/push-notifications-v2-deafic.md
--
-- 内容:
--   1. notification_queue.content_type CHECK 拡張（v2 イベント許可）
--   2. notification_log テーブル新規（送信履歴・重複防止用）
--   3. 既存 shift_*, digest, manager-action, issued-document, training-result push との共存

-- ===== 1. content_type CHECK 拡張 =====
ALTER TABLE public.notification_queue
  DROP CONSTRAINT IF EXISTS notification_queue_content_type_check;
ALTER TABLE public.notification_queue
  ADD CONSTRAINT notification_queue_content_type_check CHECK (content_type IN (
    'announcement', 'compliance', 'training', 'manual',
    'shift_ready', 'shift_publish',
    'engagement_digest',
    'unread_reminder'
  ));

-- ===== 2. notification_log =====
CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_code text NOT NULL,
  subject_id uuid,
  recipient_employee_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app','push','email')),
  status text NOT NULL CHECK (status IN ('sent','failed','revoked')),
  payload jsonb,
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_log_uniq UNIQUE (event_code, subject_id, recipient_employee_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_log_recipient
  ON public.notification_log(recipient_employee_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_event
  ON public.notification_log(event_code, subject_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at
  ON public.notification_log(sent_at);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_log_select ON public.notification_log;
CREATE POLICY notification_log_select ON public.notification_log FOR SELECT
USING (
  recipient_employee_id IN (SELECT id FROM public.employees WHERE auth_user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.employees
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
      AND tenant_id = notification_log.tenant_id
  )
);

GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;

-- ===== 3. 90 日保持 purge =====
CREATE OR REPLACE FUNCTION public.purge_old_notification_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.notification_log
   WHERE sent_at < now() - interval '90 days';
END;
$$;
