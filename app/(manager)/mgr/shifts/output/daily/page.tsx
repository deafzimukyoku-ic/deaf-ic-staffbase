'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import DailyOutputFull from '@/components/shift/DailyOutputFull';

export default function ManagerDailyOutputPage() {
  return (
    <Suspense fallback={null}>
      <DailyOutputFull role="manager" />
    </Suspense>
  );
}
