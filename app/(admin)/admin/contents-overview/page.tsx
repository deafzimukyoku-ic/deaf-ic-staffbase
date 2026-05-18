'use client';

export const dynamic = 'force-dynamic';

import { ContentsOverviewView } from '@/components/admin/ContentsOverviewView';

export default function AdminContentsOverviewPage() {
  return <ContentsOverviewView scope="admin" />;
}
