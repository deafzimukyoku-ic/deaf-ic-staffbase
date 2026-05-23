/**
 * notification_log への記録ヘルパー（deaf-ic）。
 */

import { createClient as createSbClient } from '@supabase/supabase-js';
import type { NotificationEventCode } from './event-codes';

function admin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type Channel = 'in_app' | 'push' | 'email';
type Status = 'sent' | 'failed' | 'revoked';

interface LogEntry {
  tenantId: string;
  eventCode: NotificationEventCode;
  subjectId?: string | null;
  recipientEmployeeId: string;
  channel: Channel;
  status: Status;
  payload?: Record<string, unknown>;
  error?: string;
}

export async function recordNotificationLog(entry: LogEntry): Promise<void> {
  const sb = admin();
  await sb.from('notification_log').upsert(
    {
      tenant_id: entry.tenantId,
      event_code: entry.eventCode,
      subject_id: entry.subjectId ?? null,
      recipient_employee_id: entry.recipientEmployeeId,
      channel: entry.channel,
      status: entry.status,
      payload: entry.payload ?? null,
      error: entry.error ?? null,
      sent_at: new Date().toISOString(),
    },
    { onConflict: 'event_code,subject_id,recipient_employee_id,channel', ignoreDuplicates: true },
  );
}
