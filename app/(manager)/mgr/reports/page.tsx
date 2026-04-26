'use client';

export const dynamic = 'force-dynamic';

import { ReportMatrix } from '@/components/admin/ReportMatrix';

/* マネージャー側も同じコンポーネント。
   API 側で role=manager の場合は担当 facility に自動絞り込み。 */
export default function MgrReportsPage() {
  return <ReportMatrix />;
}
