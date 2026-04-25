'use client';

export const dynamic = 'force-dynamic';

import ScheduleFull from '@/components/shift/ScheduleFull';

export default function ManagerShiftsSchedulePage() {
  return <ScheduleFull scope="manager" />;
}
