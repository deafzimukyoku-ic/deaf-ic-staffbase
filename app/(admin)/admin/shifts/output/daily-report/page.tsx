'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import DailyReportFull from '@/components/shift/DailyReportFull';

export default function AdminDailyReportPage() {
  return (
    <Suspense fallback={null}>
      <DailyReportFull role="admin" />
    </Suspense>
  );
}
