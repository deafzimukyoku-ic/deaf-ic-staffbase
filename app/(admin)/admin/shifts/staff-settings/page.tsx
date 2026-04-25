'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import StaffSettingsFull from '@/components/shift/StaffSettingsFull';

export default function AdminStaffSettingsPage() {
  return (
    <Suspense fallback={null}>
      <StaffSettingsFull scope="admin" />
    </Suspense>
  );
}
