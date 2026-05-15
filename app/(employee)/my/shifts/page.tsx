import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /my/shifts は /my/requests?tab=my-shift に統合済 (旧 MyShiftsView は同タブ内で表示)。
 * 旧 URL や email 内のリンク (shift-notification-email.ts の月別リンク) は
 * 当面 redirect で受ける。query string (month=YYYY-MM) も保持する。
 */
export default async function EmployeeShiftsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const month = typeof sp.month === 'string' ? sp.month : null;
  const target = month
    ? `/my/requests?tab=facility-shift&month=${encodeURIComponent(month)}`
    : '/my/requests?tab=facility-shift';
  redirect(target);
}
