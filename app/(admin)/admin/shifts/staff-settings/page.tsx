'use client';

export const dynamic = 'force-dynamic';

import StaffSettingsFull from '@/components/shift/StaffSettingsFull';

export default function AdminStaffSettingsPage() {
  return <StaffSettingsFull scope="admin" />;
}
