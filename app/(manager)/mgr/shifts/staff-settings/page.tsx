'use client';

export const dynamic = 'force-dynamic';

import StaffSettingsFull from '@/components/shift/StaffSettingsFull';

export default function ManagerStaffSettingsPage() {
  return <StaffSettingsFull scope="manager" />;
}
