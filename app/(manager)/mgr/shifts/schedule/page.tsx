'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ScheduleFull from '@/components/shift/ScheduleFull';

export default function ManagerShiftsSchedulePage() {
  return (
    <Suspense fallback={null}>
      <ScheduleFull scope="manager" />
    </Suspense>
  );
}
