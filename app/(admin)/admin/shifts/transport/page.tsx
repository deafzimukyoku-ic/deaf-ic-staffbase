'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import TransportFull from '@/components/shift/TransportFull';

export default function AdminShiftsTransportPage() {
  return (
    <Suspense fallback={null}>
      <TransportFull role="admin" />
    </Suspense>
  );
}
