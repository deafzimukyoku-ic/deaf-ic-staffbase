import { NextRequest, NextResponse } from 'next/server';
import { notifyEngagementDailyDigest } from '@/lib/notifications/dispatcher';

/**
 * GET/POST /api/cron/engagement-digest
 * 日次 18:00 JST cron (E3)。
 */

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await notifyEngagementDailyDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/engagement-digest] failed', err);
    return NextResponse.json({ error: 'internal error', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
