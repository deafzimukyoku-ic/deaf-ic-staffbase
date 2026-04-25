'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import FacilitySettingsFull from '@/components/shift/FacilitySettingsFull';

export default function ManagerFacilitySettingsPage() {
  return (
    <Suspense fallback={null}>
      <FacilitySettingsFull scope="manager" />
    </Suspense>
  );
}
