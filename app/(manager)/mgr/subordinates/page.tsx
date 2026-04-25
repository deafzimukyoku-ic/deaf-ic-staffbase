'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SubordinateTable } from '@/components/manager/SubordinateTable';
import { Card, CardContent } from '@/components/ui/card';

interface SubordinateRow {
  id: string;
  employee_number: string;
  last_name: string;
  first_name: string;
  facility: { name: string } | null;
  position: string | null;
  status: string;
  join_date: string;
}

export default function SubordinatesPage() {
  const [employees, setEmployees] = useState<SubordinateRow[]>([]);
  const [facilities, setFacilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me } = await supabase
        .from('employees')
        .select('id, tenant_id')
        .eq('auth_user_id', user.id)
        .single();
      if (!me) return;

      // 担当施設取得
      const { data: facs } = await supabase
        .from('manager_facilities')
        .select('facility:facilities(id, name), facility_id')
        .eq('employee_id', me.id);

      const mfs = (facs || []).map((f: any) => ({ id: f.facility_id, name: f.facility?.name })).filter((f: any) => f.name);
      const facilityIds = mfs.map((f) => f.id);

      // 所属施設を自動含行
      const { data: meFull } = await supabase.from('employees').select('facility_id').eq('id', me.id).single();
      if (meFull?.facility_id && !facilityIds.includes(meFull.facility_id)) {
        const { data: affFac } = await supabase.from('facilities').select('id, name').eq('id', meFull.facility_id).single();
        if (affFac) {
          mfs.unshift({ id: affFac.id, name: affFac.name });
          facilityIds.unshift(affFac.id);
        }
      }
      setFacilities(mfs.map(f => f.name));

      if (facilityIds.length === 0) {
        setLoading(false);
        return;
      }

      // 部下取得
      const { data: subs } = await supabase
        .from('employees')
        .select('id, employee_number, last_name, first_name, position, status, join_date, facility:facilities(name)')
        .eq('tenant_id', me.tenant_id)
        .in('facility_id', facilityIds)
        .neq('id', me.id)
        .order('employee_number');

      const formattedSubs = (subs || []).map(s => ({
        ...s,
        facility: Array.isArray(s.facility) ? s.facility[0] : s.facility
      }));

      setEmployees(formattedSubs as any);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-diletto-gray">読み込み中...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">部下管理</h1>
        <div className="flex flex-wrap gap-2">
          {facilities.map((f) => (
            <span key={f} className="inline-flex items-center rounded-full bg-diletto-blue/10 px-3 py-1 text-xs font-medium text-diletto-blue">
              {f}
            </span>
          ))}
        </div>
      </div>

      {facilities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-diletto-gray">担当施設が設定されていません。</p>
            <p className="text-sm text-diletto-gray-light mt-1">管理者に担当施設の割当を依頼してください。</p>
          </CardContent>
        </Card>
      ) : (
        <SubordinateTable employees={employees as any} />
      )}
    </div>
  );
}
