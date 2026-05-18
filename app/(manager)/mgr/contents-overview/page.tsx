'use client';

export const dynamic = 'force-dynamic';

import { ContentsOverviewView } from '@/components/admin/ContentsOverviewView';

export default function MgrContentsOverviewPage() {
  return <ContentsOverviewView scope="manager" />;
}
