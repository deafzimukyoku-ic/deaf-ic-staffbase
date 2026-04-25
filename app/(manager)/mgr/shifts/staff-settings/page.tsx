'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import StaffSettingsFull from '@/components/shift/StaffSettingsFull';

export default function ManagerStaffSettingsPage() {
  return (
    <Suspense fallback={null}>
      <StaffSettingsFull scope="manager" />
    </Suspense>
  );
}
