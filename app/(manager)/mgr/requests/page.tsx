import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AdminRequestsView from '@/components/shift/AdminRequestsView';

// manager: 自施設に固定（forceFacilityId で渡す）
export default async function ManagerRequestsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('employees')
    .select('facility_id')
    .eq('auth_user_id', user.id)
    .single();

  if (!me?.facility_id) {
    return (
      <div className="rounded-md bg-white border border-diletto-gray/10 p-8 text-center">
        <p className="text-sm text-diletto-gray">所属事業所が未設定です。</p>
      </div>
    );
  }

  return <AdminRequestsView forceFacilityId={me.facility_id} />;
}
