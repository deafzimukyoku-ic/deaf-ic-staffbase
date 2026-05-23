/**
 * 通知 dispatcher（deaf-ic）。共通仕様 push-notifications-v2.md。
 *
 * deaf-ic 専用差分:
 *   - sendWebPushToEmployees(supabase, employeeIds, payload) シグネチャ
 *   - public schema
 *   - マルチテナント
 */

import { createClient as createSbClient } from '@supabase/supabase-js';
import { sendWebPushToEmployees } from '@/lib/push/server';
import { resolveAudienceEmployeeIds } from './audience';
import { recordNotificationLog } from './log';
import { resetReadsForImportantUpdate } from './reset-reads';
import {
  NOTIFICATION_EVENTS,
  PUBLISH_CONTENT_META,
  TRAINING_RESULT_LABELS,
  UNREAD_REMINDER_CATEGORIES,
  type PublishContentType,
  type TrainingResultValue,
  type UnreadReminderCategory,
} from './event-codes';

function admin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getTenantName(tenantId: string): Promise<string> {
  const sb = admin();
  const { data } = await sb.from('tenants').select('company_name').eq('id', tenantId).maybeSingle();
  return (data as { company_name?: string } | null)?.company_name || 'staffbase';
}

// E1 publish_new
export async function notifyPublishNew(
  contentType: PublishContentType,
  itemId: string,
): Promise<{ audience: number; total: number; delivered: number; expired: number; failed: number }> {
  const meta = PUBLISH_CONTENT_META[contentType];
  const sb = admin();
  const { data: item } = await sb
    .from(meta.table)
    .select('id, title, is_published, target_type, target_facility_ids, target_position_ids, tenant_id, created_by')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { audience: 0, total: 0, delivered: 0, expired: 0, failed: 0 };
  const it = item as {
    id: string; title: string; is_published: boolean;
    target_type: 'all' | 'facility';
    target_facility_ids: string[] | null;
    target_position_ids: string[] | null;
    tenant_id: string;
    created_by: string | null;
  };
  if (!it.is_published) return { audience: 0, total: 0, delivered: 0, expired: 0, failed: 0 };

  let employeeIds = await resolveAudienceEmployeeIds(it.tenant_id, {
    target_type: it.target_type,
    target_facility_ids: it.target_facility_ids,
    target_position_ids: it.target_position_ids,
  });
  if (it.created_by) employeeIds = employeeIds.filter((id) => id !== it.created_by);
  if (employeeIds.length === 0) return { audience: 0, total: 0, delivered: 0, expired: 0, failed: 0 };

  const tenantName = await getTenantName(it.tenant_id);
  const result = await sendWebPushToEmployees(sb, employeeIds, {
    title: `【${tenantName}】${meta.label}『${it.title}』が公開されました`,
    body: 'アプリを開いて内容を確認してください。',
    url: meta.urlPath,
    tag: `${contentType}:${it.id}:publish`,
  });

  await Promise.all(
    employeeIds.map((eid) =>
      recordNotificationLog({
        tenantId: it.tenant_id,
        eventCode: NOTIFICATION_EVENTS.PUBLISH_NEW,
        subjectId: it.id,
        recipientEmployeeId: eid,
        channel: 'push',
        status: 'sent',
        payload: { contentType, title: it.title },
      }),
    ),
  );

  return { audience: employeeIds.length, ...result };
}

// E2 publish_important_update
export async function notifyPublishImportantUpdate(
  contentType: PublishContentType,
  itemId: string,
): Promise<{ audience: number; total: number; delivered: number; expired: number; failed: number; readsDeleted: number }> {
  const meta = PUBLISH_CONTENT_META[contentType];
  const sb = admin();
  const { data: item } = await sb
    .from(meta.table)
    .select('id, title, is_published, target_type, target_facility_ids, target_position_ids, tenant_id, created_by')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return { audience: 0, total: 0, delivered: 0, expired: 0, failed: 0, readsDeleted: 0 };
  const it = item as {
    id: string; title: string; is_published: boolean;
    target_type: 'all' | 'facility';
    target_facility_ids: string[] | null;
    target_position_ids: string[] | null;
    tenant_id: string;
    created_by: string | null;
  };
  if (!it.is_published) return { audience: 0, total: 0, delivered: 0, expired: 0, failed: 0, readsDeleted: 0 };

  const { deleted } = await resetReadsForImportantUpdate(contentType, itemId);

  let employeeIds = await resolveAudienceEmployeeIds(it.tenant_id, {
    target_type: it.target_type,
    target_facility_ids: it.target_facility_ids,
    target_position_ids: it.target_position_ids,
  });
  if (it.created_by) employeeIds = employeeIds.filter((id) => id !== it.created_by);
  if (employeeIds.length === 0) return { audience: 0, total: 0, delivered: 0, expired: 0, failed: 0, readsDeleted: deleted };

  const tenantName = await getTenantName(it.tenant_id);
  const result = await sendWebPushToEmployees(sb, employeeIds, {
    title: `【${tenantName}】${meta.label}『${it.title}』が更新されました`,
    body: '重要な変更があります。再度確認してください。',
    url: meta.urlPath,
    tag: `${contentType}:${it.id}:update`,
  });

  await Promise.all(
    employeeIds.map((eid) =>
      recordNotificationLog({
        tenantId: it.tenant_id,
        eventCode: NOTIFICATION_EVENTS.PUBLISH_IMPORTANT_UPDATE,
        subjectId: it.id,
        recipientEmployeeId: eid,
        channel: 'push',
        status: 'sent',
        payload: { contentType, title: it.title, readsDeleted: deleted },
      }),
    ),
  );

  return { audience: employeeIds.length, ...result, readsDeleted: deleted };
}

// E5 training_result
export async function notifyTrainingResult(
  submissionId: string,
  result: TrainingResultValue,
  comment?: string,
): Promise<{ total: number; delivered: number; expired: number; failed: number }> {
  const sb = admin();
  const { data: sub } = await sb
    .from('training_submissions')
    .select('id, employee_id, training_id, tenant_id, trainings:training_id(title)')
    .eq('id', submissionId)
    .maybeSingle();
  if (!sub) return { total: 0, delivered: 0, expired: 0, failed: 0 };
  const s = sub as unknown as {
    id: string; employee_id: string; training_id: string; tenant_id: string;
    trainings: { title: string } | null;
  };
  const title = s.trainings?.title ?? '研修';
  const label = TRAINING_RESULT_LABELS[result];
  const body = comment ? `${label} ・ ${comment}` : label;

  const r = await sendWebPushToEmployees(sb, [s.employee_id], {
    title: `研修『${title}』の判定結果`,
    body,
    url: '/my/trainings',
    tag: `training-result:${s.id}`,
  });

  await recordNotificationLog({
    tenantId: s.tenant_id,
    eventCode: NOTIFICATION_EVENTS.TRAINING_RESULT,
    subjectId: s.id,
    recipientEmployeeId: s.employee_id,
    channel: 'push',
    status: 'sent',
    payload: { result, title, comment },
  });

  return r;
}

// E4 unread_reminder_manual
export async function notifyUnreadReminderManual(args: {
  tenantId: string;
  employeeIds: string[];
  category: UnreadReminderCategory;
  unreadCount?: number;
}): Promise<{ total: number; delivered: number; expired: number; failed: number }> {
  const cat = UNREAD_REMINDER_CATEGORIES[args.category];
  const count = args.unreadCount ?? 0;
  const sb = admin();
  const r = await sendWebPushToEmployees(sb, args.employeeIds, {
    title: `【リマインダー】未読の${cat.label}があります`,
    body: count > 0
      ? `${count}件 未確認です。アプリで確認してください。`
      : 'アプリで確認してください。',
    url: cat.urlPath,
    tag: `unread-reminder:${args.category}`,
  });

  await Promise.all(
    args.employeeIds.map((eid) =>
      recordNotificationLog({
        tenantId: args.tenantId,
        eventCode: NOTIFICATION_EVENTS.UNREAD_REMINDER_MANUAL,
        subjectId: null,
        recipientEmployeeId: eid,
        channel: 'push',
        status: 'sent',
        payload: { category: args.category, unreadCount: count },
      }),
    ),
  );

  return r;
}

// E3 engagement_daily_digest
type DigestItemRow = { contentType: string; title: string; count: number };

export async function notifyEngagementDailyDigest(): Promise<{ publishers: number; sent: number }> {
  const sb = admin();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  type Bucket = Map<string, { tenantId: string; items: DigestItemRow[] }>;
  const byPublisher: Bucket = new Map();

  // 1. announcement_reads
  {
    const { data } = await sb
      .from('announcement_reads')
      .select('announcement_id, announcements:announcement_id(id,title,created_by,tenant_id)')
      .gte('read_at', since);
    type Row = { announcements: { id: string; title: string; created_by: string | null; tenant_id: string } | null };
    const counts = new Map<string, { tenantId: string; title: string; createdBy: string; count: number }>();
    for (const r of ((data ?? []) as unknown as Row[])) {
      const a = r.announcements;
      if (!a || !a.created_by) continue;
      const cur = counts.get(a.id) ?? { tenantId: a.tenant_id, title: a.title, createdBy: a.created_by, count: 0 };
      cur.count++;
      counts.set(a.id, cur);
    }
    for (const v of counts.values()) {
      const cur = byPublisher.get(v.createdBy) ?? { tenantId: v.tenantId, items: [] };
      cur.items.push({ contentType: 'announcement', title: v.title, count: v.count });
      byPublisher.set(v.createdBy, cur);
    }
  }

  // 2. manual_reads
  {
    const { data } = await sb
      .from('manual_reads')
      .select('manual_id, manuals:manual_id(id,title,created_by,tenant_id)')
      .gte('read_at', since);
    type Row = { manuals: { id: string; title: string; created_by: string | null; tenant_id: string } | null };
    const counts = new Map<string, { tenantId: string; title: string; createdBy: string; count: number }>();
    for (const r of ((data ?? []) as unknown as Row[])) {
      const a = r.manuals;
      if (!a || !a.created_by) continue;
      const cur = counts.get(a.id) ?? { tenantId: a.tenant_id, title: a.title, createdBy: a.created_by, count: 0 };
      cur.count++;
      counts.set(a.id, cur);
    }
    for (const v of counts.values()) {
      const cur = byPublisher.get(v.createdBy) ?? { tenantId: v.tenantId, items: [] };
      cur.items.push({ contentType: 'manual', title: v.title, count: v.count });
      byPublisher.set(v.createdBy, cur);
    }
  }

  // 3. compliance_acknowledgments
  {
    const { data } = await sb
      .from('compliance_acknowledgments')
      .select('compliance_document_id, compliance_documents:compliance_document_id(id,title,created_by,tenant_id)')
      .gte('acknowledged_at', since);
    type Row = { compliance_documents: { id: string; title: string; created_by: string | null; tenant_id: string } | null };
    const counts = new Map<string, { tenantId: string; title: string; createdBy: string; count: number }>();
    for (const r of ((data ?? []) as unknown as Row[])) {
      const a = r.compliance_documents;
      if (!a || !a.created_by) continue;
      const cur = counts.get(a.id) ?? { tenantId: a.tenant_id, title: a.title, createdBy: a.created_by, count: 0 };
      cur.count++;
      counts.set(a.id, cur);
    }
    for (const v of counts.values()) {
      const cur = byPublisher.get(v.createdBy) ?? { tenantId: v.tenantId, items: [] };
      cur.items.push({ contentType: 'compliance', title: v.title, count: v.count });
      byPublisher.set(v.createdBy, cur);
    }
  }

  // 4. training_submissions
  {
    const { data } = await sb
      .from('training_submissions')
      .select('training_id, trainings:training_id(id,title,created_by,tenant_id)')
      .gte('submitted_at', since);
    type Row = { trainings: { id: string; title: string; created_by: string | null; tenant_id: string } | null };
    const counts = new Map<string, { tenantId: string; title: string; createdBy: string; count: number }>();
    for (const r of ((data ?? []) as unknown as Row[])) {
      const a = r.trainings;
      if (!a || !a.created_by) continue;
      const cur = counts.get(a.id) ?? { tenantId: a.tenant_id, title: a.title, createdBy: a.created_by, count: 0 };
      cur.count++;
      counts.set(a.id, cur);
    }
    for (const v of counts.values()) {
      const cur = byPublisher.get(v.createdBy) ?? { tenantId: v.tenantId, items: [] };
      cur.items.push({ contentType: 'training', title: v.title, count: v.count });
      byPublisher.set(v.createdBy, cur);
    }
  }

  // 5. 配信
  const today = new Date().toISOString().slice(0, 10);
  let sentTotal = 0;
  for (const [publisherId, info] of byPublisher.entries()) {
    if (info.items.length === 0) continue;
    const previewLines = info.items.slice(0, 4).map((it) => {
      const label = (PUBLISH_CONTENT_META[it.contentType as PublishContentType]?.label) ?? it.contentType;
      const verb = it.contentType === 'training' ? '提出' : '既読';
      return `${label}「${it.title}」 ${verb}${it.count}件`;
    });
    const overflow = info.items.length - previewLines.length;
    const body = overflow > 0
      ? [...previewLines, `他 ${overflow} 件`].join('\n')
      : previewLines.join('\n');

    const r = await sendWebPushToEmployees(sb, [publisherId], {
      title: '本日の既読・提出サマリ',
      body,
      url: '/admin/dashboard',
      tag: `engagement-digest:${publisherId}:${today}`,
    });
    sentTotal += r.delivered;
    await recordNotificationLog({
      tenantId: info.tenantId,
      eventCode: NOTIFICATION_EVENTS.ENGAGEMENT_DAILY_DIGEST,
      subjectId: null,
      recipientEmployeeId: publisherId,
      channel: 'push',
      status: 'sent',
      payload: { date: today, itemCount: info.items.length },
    });
  }

  return { publishers: byPublisher.size, sent: sentTotal };
}
