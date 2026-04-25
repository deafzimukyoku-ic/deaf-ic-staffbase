'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import AdminRequestsView from '@/components/shift/AdminRequestsView';

export default function AdminRequestsPage() {
  return (
    <Suspense fallback={null}>
      <AdminRequestsView />
    </Suspense>
  );
}
