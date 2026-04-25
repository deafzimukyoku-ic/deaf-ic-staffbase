'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import FacilitySettingsFull from '@/components/shift/FacilitySettingsFull';

export default function AdminFacilitySettingsPage() {
  return (
    <Suspense fallback={null}>
      <FacilitySettingsFull scope="admin" />
    </Suspense>
  );
}
