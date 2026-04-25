import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import MyShiftsView from '@/components/shift/MyShiftsView';

// employee 自身のシフト閲覧画面（タスクF）
// RLS により ready/published の自分の分のみ取得される（migration 107）
export default async function EmployeeShiftsPage() {
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

  return <MyShiftsView employeeId={me.id} tenantId={me.tenant_id} facilityId={me.facility_id} />;
}
