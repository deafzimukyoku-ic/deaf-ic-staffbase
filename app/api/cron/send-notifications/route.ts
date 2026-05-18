import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { buildDigestEmail, type DigestItem } from '@/lib/email/digest-email';
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

  /* 175-B: コンテンツ系 (announcement / compliance / training / manual) は
     社員ごとに集約して 1 通の digest メールに。シフト系 (shift_ready / shift_publish)
     は既存 processShiftRow のまま 1 通 = 1 通信。 */
  const rows = (queueRows || []) as QueueRow[];
  const shiftRows = rows.filter((r) => r.content_type === 'shift_ready' || r.content_type === 'shift_publish');
  const contentRows = rows.filter((r) => r.content_type !== 'shift_ready' && r.content_type !== 'shift_publish');

  /* シフト系は 1 行ずつ既存ロジックで処理 */
  for (const row of shiftRows) {
    stats.processed++;
    try {
      const result = await processShiftRow(supabase, row, appUrl);
      if (result === 'sent') stats.sent++;
      else stats.skipped++;
    } catch (err) {
      stats.errors++;
      console.error('[cron/send-notifications] shift row failed', row.id, err);
    }
  }

  /* コンテンツ系を社員ごとに集約 */
  if (contentRows.length > 0) {
    try {
      const digestStats = await processContentDigest(supabase, contentRows, appUrl);
      stats.processed += digestStats.processed;
      stats.sent += digestStats.sent;
      stats.skipped += digestStats.skipped;
      stats.errors += digestStats.errors;
    } catch (err) {
      stats.errors += contentRows.length;
      console.error('[cron/send-notifications] digest batch failed', err);
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

/* 175-B: 「2h ウィンドウ digest」処理。
   コンテンツ系の未送信キューを社員ごとに集約 → 1 通の digest メールに。
   流れ:
     1. テナントごとに行を groupBy
     2. テナント内で全 (content_type, content_id) について content を一括取得
        (削除済 / 非公開 / facility 不正 → 該当 row を cancelled マークして除外)
     3. テナントの全 active 社員を取得し、social row への facility / created_by フィルタを
        メモリ上で適用 → employee → 配送 items[] のマップを構築
     4. 社員ごとに digest メール 1 通 (resend.batch.send で 100 件ずつ)
     5. 成功したテナント内の全 row を sent_at マーク
   失敗時はそのテナントの全 row が次回 cron で再試行される (digest 単位での atomicity)。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processContentDigest(
  supabase: any,
  rows: QueueRow[],
  appUrl: string,
): Promise<{ processed: number; sent: number; skipped: number; errors: number }> {
  const stats = { processed: 0, sent: 0, skipped: 0, errors: 0 };

  /* テナントごとに分離 */
  const byTenant = new Map<string, QueueRow[]>();
  for (const r of rows) {
    const arr = byTenant.get(r.tenant_id) ?? [];
    arr.push(r);
    byTenant.set(r.tenant_id, arr);
  }

  for (const [tenantId, tenantRows] of byTenant) {
    stats.processed += tenantRows.length;
    try {
      const result = await processTenantDigest(supabase, tenantId, tenantRows, appUrl);
      stats.sent += result.sent;
      stats.skipped += result.skipped;
    } catch (err) {
      stats.errors += tenantRows.length;
      console.error('[cron/digest] tenant batch failed', { tenantId, err });
    }
  }
  return stats;
}

interface ResolvedContent {
  row: QueueRow;
  title: string;
  target_type: string;
  target_facility_ids: string[] | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processTenantDigest(
  supabase: any,
  tenantId: string,
  rows: QueueRow[],
  appUrl: string,
): Promise<{ sent: number; skipped: number }> {
  const cancelledIds: string[] = [];
  const sentIds: string[] = [];

  /* content_type ごとに id 配列を集めて 1 回ずつ in クエリ */
  const idsByType = new Map<LegacyNotificationContentType, string[]>();
  for (const r of rows) {
    if (!r.content_id) {
      cancelledIds.push(r.id);
      continue;
    }
    const ct = r.content_type as LegacyNotificationContentType;
    const arr = idsByType.get(ct) ?? [];
    arr.push(r.content_id);
    idsByType.set(ct, arr);
  }

  const resolved: ResolvedContent[] = [];
  for (const [ct, ids] of idsByType) {
    const fieldTitle = ct === 'compliance' ? 'title, content' : ct === 'training' ? 'title' : 'title, body';
    const { data: contents } = await supabase
      .from(CONTENT_TABLE[ct])
      .select(`id, tenant_id, target_type, target_facility_ids, is_published, ${fieldTitle}`)
      .eq('tenant_id', tenantId)
      .in('id', ids);
    const map = new Map(((contents ?? []) as Array<{ id: string; is_published: boolean; target_type: string; target_facility_ids: string[] | null; title: string | null }>).map((c) => [c.id, c]));
    for (const r of rows) {
      if (r.content_type !== ct || !r.content_id) continue;
      const c = map.get(r.content_id);
      if (!c) {
        /* 削除済 */
        cancelledIds.push(r.id);
        continue;
      }
      if (c.is_published === false) {
        /* 非公開 (二重防御) */
        cancelledIds.push(r.id);
        continue;
      }
      resolved.push({
        row: r,
        title: c.title || (ct === 'announcement' ? '（無題のお知らせ）' : '（無題）'),
        target_type: c.target_type,
        target_facility_ids: c.target_facility_ids,
      });
    }
  }

  /* facility 全削除チェック */
  const allFacilityIds = new Set<string>();
  for (const r of resolved) {
    if (r.target_type === 'facility' && r.target_facility_ids) {
      for (const fid of r.target_facility_ids) allFacilityIds.add(fid);
    }
  }
  let validFacilityIds = new Set<string>();
  if (allFacilityIds.size > 0) {
    const { data: facs } = await supabase
      .from('facilities')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(allFacilityIds));
    validFacilityIds = new Set((facs ?? []).map((f: { id: string }) => f.id));
  }

  /* 配送可能な items だけ残す */
  const deliverable = resolved.filter((r) => {
    if (r.target_type === 'facility') {
      if (!r.target_facility_ids || r.target_facility_ids.length === 0) {
        cancelledIds.push(r.row.id);
        return false;
      }
      if (!r.target_facility_ids.some((fid) => validFacilityIds.has(fid))) {
        cancelledIds.push(r.row.id);
        return false;
      }
    }
    return true;
  });

  /* 社員一覧 (active + email あり) を取得 */
  const { data: allEmployees } = await supabase
    .from('employees')
    .select('id, email, facility_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .not('email', 'is', null);
  const employees = ((allEmployees ?? []) as Array<{ id: string; email: string; facility_id: string | null }>).filter((e) => isValidEmail(e.email));

  /* employee → 届ける items */
  const itemsByEmployee = new Map<string, { email: string; items: DigestItem[] }>();
  for (const r of deliverable) {
    for (const e of employees) {
      /* 投稿者本人 (created_by) は除外 */
      if (r.row.created_by && r.row.created_by === e.id) continue;
      if (r.target_type === 'all') {
        // ok
      } else if (r.target_type === 'facility') {
        if (!e.facility_id || !(r.target_facility_ids ?? []).includes(e.facility_id)) continue;
      } else {
        continue;
      }
      const cur = itemsByEmployee.get(e.id) ?? { email: e.email, items: [] };
      cur.items.push({ contentType: r.row.content_type as LegacyNotificationContentType, title: r.title });
      itemsByEmployee.set(e.id, cur);
    }
  }

  /* 配送先 0 名の row も sent 扱い (再試行不要) */
  for (const r of deliverable) {
    sentIds.push(r.row.id); /* 後で in クエリで一括 update */
  }

  /* テナント名 */
  const { data: tenant } = await supabase
    .from('tenants')
    .select('company_name')
    .eq('id', tenantId)
    .single();
  const companyName = tenant?.company_name || '名古屋ろう国際センター';

  /* 社員ごとに digest メール構築 → batch send */
  const emails: Array<{ from: string; to: string[]; subject: string; html: string; text: string }> = [];
  for (const { email, items } of itemsByEmployee.values()) {
    const { subject, html, text } = buildDigestEmail({ companyName, appUrl, items });
    emails.push({ from: FROM_EMAIL, to: [email], subject, html, text });
  }

  for (let i = 0; i < emails.length; i += RESEND_BATCH_SIZE) {
    const chunk = emails.slice(i, i + RESEND_BATCH_SIZE);
    if (chunk.length === 0) continue;
    const res = await resend.batch.send(chunk);
    if (res.error) {
      console.error('[cron/digest] resend batch failed', { tenantId, error: res.error });
      throw new Error(`resend error: ${res.error.message || JSON.stringify(res.error)}`);
    }
  }

  /* 一括マーク */
  const nowIso = new Date().toISOString();
  if (cancelledIds.length > 0) {
    await supabase.from('notification_queue').update({ cancelled_at: nowIso }).in('id', cancelledIds);
  }
  if (sentIds.length > 0) {
    await supabase.from('notification_queue').update({ sent_at: nowIso }).in('id', sentIds);
  }
  return { sent: sentIds.length, skipped: cancelledIds.length };
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
