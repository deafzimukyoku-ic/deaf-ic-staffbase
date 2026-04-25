'use client';

export const dynamic = 'force-dynamic';

import ScheduleFull from '@/components/shift/ScheduleFull';

export default function AdminShiftsSchedulePage() {
  return <ScheduleFull scope="admin" />;
}
