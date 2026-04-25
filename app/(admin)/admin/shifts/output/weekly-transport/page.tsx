'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import WeeklyTransportFull from '@/components/shift/WeeklyTransportFull';

export default function AdminWeeklyTransportPage() {
  return (
    <Suspense fallback={null}>
      <WeeklyTransportFull role="admin" />
    </Suspense>
  );
}
