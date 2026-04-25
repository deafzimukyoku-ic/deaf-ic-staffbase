'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ShiftFull from '@/components/shift/ShiftFull';

export default function ManagerShiftsPage() {
  return (
    <Suspense fallback={null}>
      <ShiftFull role="manager" />
    </Suspense>
  );
}
