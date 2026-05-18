'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * マッピングページ（レガシー）
 * PDF専用化に伴い、エディタページにリダイレクト
 */
export default function MappingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/admin/documents/${id}/editor`);
  }, [id, router]);

  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" />
      <span className="ml-3 text-sm text-brand-gray">エディタに移動中...</span>
    </div>
  );
}
