import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import MyRequestsView from '@/components/shift/MyRequestsView';

export const dynamic = 'force-dynamic';

// employee 自身の休み希望提出（タスクC-1）
export default async function EmployeeRequestsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('employees')
    .select('id, tenant_id, facility_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!me?.facility_id) {
    return (
      <div className="rounded-md bg-white border border-diletto-gray/10 p-8 text-center">
        <p className="text-sm text-diletto-gray">所属事業所が未設定です。管理者にお問い合わせください。</p>
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <MyRequestsView employeeId={me.id} tenantId={me.tenant_id} facilityId={me.facility_id} />
    </Suspense>
  );
}
