import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { buildNotificationEmail } from '@/lib/email/notification-email';
import {
  buildShiftPublishEmail,
  buildShiftReadyEmail,
} from '@/lib/email/shift-notification-email';
import type {
  NotificationContentType,
  LegacyNotificationContentType,
} from '@/lib/types';

// Vercel Cron: */10 * * * * から呼ばれる
// 認証: Authorization: Bearer ${CRON_SECRET}
// scheduled_at <= now() かつ 未送信・未キャンセル の行を処理
//
// migration 106: shift_ready / shift_publish タイプを追加。これらは
// content_id を使わず facility_id + meta(year/month) で識別する。

const BATCH_SIZE = 50; // 1回のCron実行で処理する最大行数
const RESEND_BATCH_SIZE = 100; // Resend batch API の上限

/* Resend は to に non-ASCII (●● 等) が混ざるとバッチ全体を 422 で拒否する。
   1 件の不正アドレスのために残り 49 件が巻き添えになる事故が起きたため、
   submit 前に簡易検証して non-ASCII / 空文字を弾く。 */
function isValidEmail(addr: string | null | undefined): addr is string {
  if (!addr) return false;
  if (!/^[\x20-\x7E]+$/.test(addr)) return false; /* ASCII printable のみ */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return false;
  return true;
}

const CONTENT_TABLE: Record<LegacyNotificationContentType, string> = {
  announcement: 'announcements',
  compliance: 'compliance_documents',
  training: 'trainings',
  manual: 'manuals',
};

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  // Cron認証
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  /* メール内の URL リンク用。優先順位:
       env APP_URL → env NEXT_PUBLIC_APP_URL → req.nextUrl.origin (実際の Host)
     Vercel に env 未設定でも、本番ドメインで叩いた場合は origin から取得して継続。
     localhost で叩いた場合は localhost:6001 になるためメール内のリンクも localhost に
     なるが、ローカル検証時の挙動として許容範囲。 */
  const appUrl =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    req.nextUrl.origin;

  // service roleでRLSバイパス
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const nowIso = new Date().toISOString();

  const { data: queueRows, error: queueErr } = await supabase
    .from('notification_queue')
    .select('id, tenant_id, content_type, content_id, created_by, scheduled_at, facility_id, meta')
    .lte('scheduled_at', nowIso)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (queueErr) {
    return NextResponse.json({ error: queueErr.message }, { status: 500 });
  }

  const stats = { processed: 0, sent: 0, skipped: 0, errors: 0 };

  for (const row of queueRows || []) {
    stats.processed++;
    try {
      const result = await processRow(supabase, row, appUrl);
      if (result === 'sent') stats.sent++;
      else stats.skipped++;
    } catch (err) {
      stats.errors++;
      console.error('[cron/send-notifications] row failed', row.id, err);
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}

type QueueRow = {
  id: string;
  tenant_id: string;
  content_type: NotificationContentType;
  content_id: string | null;
  created_by: string | null;
  scheduled_at: string;
  facility_id: string | null;
  meta: { year?: number; month?: number; kind?: string } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processRow(supabase: any, row: QueueRow, appUrl: string): Promise<'sent' | 'skipped'> {
  // シフト系は別処理にディスパッチ
  if (row.content_type === 'shift_ready' || row.content_type === 'shift_publish') {
    return processShiftRow(supabase, row, appUrl);
  }

  const table = CONTENT_TABLE[row.content_type as LegacyNotificationContentType];

  // コンテンツ取得
  const fieldTitle = row.content_type === 'compliance' ? 'title, content' : row.content_type === 'training' ? 'title' : 'title, body';
  const { data: content } = await supabase
    .from(table)
    .select(`id, tenant_id, target_type, target_facility_ids, ${fieldTitle}`)
    .eq('id', row.content_id)
    .maybeSingle();

  if (!content) {
    // 削除済み → キャンセル扱い
    await supabase.from('notification_queue').update({ cancelled_at: new Date().toISOString() }).eq('id', row.id);
    return 'skipped';
  }

  // 施設スコープ検証
  if (content.target_type === 'facility') {
    if (!content.target_facility_ids || content.target_facility_ids.length === 0) {
      await supabase.from('notification_queue').update({ cancelled_at: new Date().toISOString() }).eq('id', row.id);
      return 'skipped';
    }
    // 指定施設が全部削除されていたらスキップ
    const { data: validFacilities } = await supabase
      .from('facilities')
      .select('id')
      .eq('tenant_id', row.tenant_id)
      .in('id', content.target_facility_ids);
    if (!validFacilities || validFacilities.length === 0) {
      await supabase.from('notification_queue').update({ cancelled_at: new Date().toISOString() }).eq('id', row.id);
      return 'skipped';
    }
  }

  // 宛先取得: active社員 & スコープ合致 & 自分以外
  let empQuery = supabase
    .from('employees')
    .select('id, email, facility_id')
    .eq('tenant_id', row.tenant_id)
    .eq('status', 'active')
    .not('email', 'is', null);

  if (row.created_by) empQuery = empQuery.neq('id', row.created_by);

  const { data: allEmployees } = await empQuery;

  const recipients = (allEmployees || []).filter((e: { facility_id: string | null; email: string }) => {
    /* ★ non-ASCII / 不正形式の email は除外 (Resend が 422 で全件巻き添えになる事故防止) */
    if (!isValidEmail(e.email)) {
      console.warn('[cron] skip invalid email:', e.email);
      return false;
    }
    if (content.target_type === 'all') return true;
    if (!e.facility_id) return false;
    return content.target_facility_ids.includes(e.facility_id);
  });

  if (recipients.length === 0) {
    await supabase.from('notification_queue').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
    return 'skipped';
  }

  // テナント名取得
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name')
    .eq('id', row.tenant_id)
    .single();

  const title = content.title || (row.content_type === 'announcement' ? '（無題のお知らせ）' : '（無題）');

  // 本文はメールに同梱しない（buildNotificationEmail 側コメント参照）。
  const { subject, html, text } = buildNotificationEmail({
    contentType: row.content_type,
    title,
    companyName: tenant?.company_name || 'staffbase',
    appUrl,
  });

  // Resend バッチ送信（最大100件ずつ）
  // ★ resend.batch.send は { data, error } を返す。error を check しないと
  //   422 (validation_error) 等で全件失敗してても sent_at がセットされて再送不能になる。
  for (let i = 0; i < recipients.length; i += RESEND_BATCH_SIZE) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_SIZE);
    const emails = chunk.map((r: { email: string }) => ({
      from: FROM_EMAIL,
      to: [r.email],
      subject,
      html,
      text,
    }));
    const res = await resend.batch.send(emails);
    if (res.error) {
      console.error('[cron] resend batch failed', { id: row.id, error: res.error });
      throw new Error(`resend error: ${res.error.message || JSON.stringify(res.error)}`);
    }
  }

  await supabase.from('notification_queue').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
  return 'sent';
}

// シフト系通知（shift_ready / shift_publish）の処理
// shift_ready: 該当 facility の active employee 全員に「仮シフト確認のお願い」
// shift_publish: tenant 全 active admin に「シフト公開しました」
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processShiftRow(supabase: any, row: QueueRow, appUrl: string): Promise<'sent' | 'skipped'> {
  if (!row.facility_id || !row.meta?.year || !row.meta?.month) {
    await supabase
      .from('notification_queue')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', row.id);
    return 'skipped';
  }

  const { year, month } = row.meta;

  // facility 情報
  const { data: facility } = await supabase
    .from('facilities')
    .select('id, name, tenant_id')
    .eq('id', row.facility_id)
    .maybeSingle();
  if (!facility) {
    await supabase
      .from('notification_queue')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', row.id);
    return 'skipped';
  }

  // 公開者の名前（created_by から）
  let publisherName = '管理者';
  if (row.created_by) {
    const { data: pub } = await supabase
      .from('employees')
      .select('full_name, last_name, first_name')
      .eq('id', row.created_by)
      .maybeSingle();
    publisherName =
      pub?.full_name ||
      [pub?.last_name, pub?.first_name].filter(Boolean).join(' ') ||
      '管理者';
  }

  // 宛先の決定
  let recipients: { email: string }[] = [];
  if (row.content_type === 'shift_publish') {
    // NPO 全 active admin
    const { data: admins } = await supabase
      .from('employees')
      .select('id, email')
      .eq('tenant_id', row.tenant_id)
      .eq('role', 'admin')
      .eq('status', 'active')
      .not('email', 'is', null);
    recipients = (admins ?? []).filter((a: { email: string | null }) => isValidEmail(a.email)) as { email: string }[];
  } else {
    // shift_ready: 該当 facility の active employee 全員
    const { data: emps } = await supabase
      .from('employees')
      .select('id, email')
      .eq('tenant_id', row.tenant_id)
      .eq('facility_id', row.facility_id)
      .eq('role', 'employee')
      .eq('status', 'active')
      .not('email', 'is', null);
    recipients = (emps ?? []).filter((e: { email: string | null }) => isValidEmail(e.email)) as { email: string }[];
  }

  if (recipients.length === 0) {
    await supabase.from('notification_queue').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
    return 'skipped';
  }

  const emailArgs = {
    year,
    month,
    facilityName: facility.name,
    publisherName,
    publishedAt: row.scheduled_at,
    appUrl,
  };
  const { subject, html, text } =
    row.content_type === 'shift_publish'
      ? buildShiftPublishEmail(emailArgs)
      : buildShiftReadyEmail(emailArgs);

  for (let i = 0; i < recipients.length; i += RESEND_BATCH_SIZE) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_SIZE);
    const emails = chunk.map((r) => ({
      from: FROM_EMAIL,
      to: [r.email],
      subject,
      html,
      text,
    }));
    const res = await resend.batch.send(emails);
    if (res.error) {
      console.error('[cron/shift] resend batch failed', { id: row.id, error: res.error });
      throw new Error(`resend error: ${res.error.message || JSON.stringify(res.error)}`);
    }
  }

  await supabase.from('notification_queue').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
  return 'sent';
}
