'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SubordinateDetail } from '@/components/manager/SubordinateDetail';

export default function SubordinateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [employee, setEmployee] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      /* 一覧と同じく SECURITY DEFINER RPC（migration 149）経由で詳細取得。
         employees 直アクセスは RLS で manager に SELECT が開放されておらず、
         直接クエリでは manager / shift_manager 全員が「閲覧する権限がありません」になる。
         RPC 内で admin / manager / shift_manager の認可判定を行い、
         認可外なら NULL を返す。返却フィールドは MANAGER_VISIBLE_FIELDS に限定。 */
      const { data: emp, error } = await supabase.rpc('get_subordinate_detail', {
        p_id: id,
      });
      if (error) {
        /* PostgrestError は console.error では中身が空に見えがちなので個別フィールドで出す */
        console.error('get_subordinate_detail failed', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        setUnauthorized(true);
        setLoading(false);
        return;
      }
      if (!emp) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      setEmployee(emp as unknown as Record<string, unknown>);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-diletto-gray">読み込み中...</span>
      </div>
    );
  }

  if (unauthorized || !employee) {
    return (
      <div className="text-center py-12">
        <p className="text-diletto-red mb-4">この社員の情報を閲覧する権限がありません。</p>
        <Button variant="outline" onClick={() => router.push('/mgr/subordinates')}>
          一覧に戻る
        </Button>
      </div>
    );
  }

  const emp = employee as Record<string, unknown>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {emp.last_name as string} {emp.first_name as string}
            </h1>
            {emp.status === 'active' ? (
              <Badge className="bg-diletto-green/10 text-diletto-green border-diletto-green/20">在籍</Badge>
            ) : (
              <Badge className="bg-diletto-red/[0.06] text-diletto-red border-diletto-red/15">退職</Badge>
            )}
          </div>
          <p className="text-sm text-diletto-gray mt-1">
            {emp.employee_number as string} / {emp.facility ? (Array.isArray(emp.facility) ? (emp.facility as any)[0]?.name : (emp.facility as any).name) : '-'}
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push('/mgr/subordinates')}>
          一覧に戻る
        </Button>
      </div>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <SubordinateDetail employee={emp as any} />
    </div>
  );
}
