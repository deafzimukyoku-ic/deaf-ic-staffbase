'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ShiftFull from '@/components/shift/ShiftFull';

export default function AdminShiftsPage() {
  return (
    <Suspense fallback={null}>
      <ShiftFull role="admin" />
    </Suspense>
  );
}
