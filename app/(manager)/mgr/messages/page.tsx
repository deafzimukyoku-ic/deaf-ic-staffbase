'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import MessagesView from '@/components/messages/MessagesView';

export default function ManagerMessagesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-diletto-gray">読み込み中...</div>}>
      <MessagesView scope="manager" />
    </Suspense>
  );
}
