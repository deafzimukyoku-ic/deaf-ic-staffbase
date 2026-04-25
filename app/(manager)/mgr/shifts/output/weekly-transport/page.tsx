'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import WeeklyTransportFull from '@/components/shift/WeeklyTransportFull';

export default function ManagerWeeklyTransportPage() {
  return (
    <Suspense fallback={null}>
      <WeeklyTransportFull role="manager" />
    </Suspense>
  );
}
