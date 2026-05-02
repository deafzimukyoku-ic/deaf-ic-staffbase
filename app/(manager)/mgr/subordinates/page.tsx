'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SubordinateTable } from '@/components/manager/SubordinateTable';
import { Card, CardContent } from '@/components/ui/card';
import { useShiftFacilityId } from '@/lib/shift-facility';

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
  const [loading, setLoading] = useState(true);
  /* /mgr 共通ヘッダーの FacilityHeaderSelector で選択中の事業所。
     これに連動して該当施設の社員のみ表示する。 */
  const [selectedFacilityId] = useShiftFacilityId();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      /* 部下取得は SECURITY DEFINER RPC 経由（migration 146 / 148）。
         employees 直アクセスは RLS で manager に開放されていないため、
         RPC で必要項目のみ取り出す。p_facility_id にヘッダー選択値を渡して絞り込む。 */
      const { data: subs, error } = await supabase.rpc('get_my_subordinates', {
        p_facility_id: selectedFacilityId ?? null,
      });
      if (error) {
        console.error('get_my_subordinates failed', error);
        setLoading(false);
        return;
      }
      type RpcRow = {
        id: string; employee_number: string;
        last_name: string; first_name: string;
        /* position は PostgreSQL 予約語のため RPC 戻り値では employee_position 名 */
        employee_position: string | null; status: string; join_date: string;
        facility_id: string | null; facility_name: string | null;
      };
      const formattedSubs: SubordinateRow[] = ((subs ?? []) as RpcRow[]).map((s) => ({
        id: s.id,
        employee_number: s.employee_number,
        last_name: s.last_name,
        first_name: s.first_name,
        position: s.employee_position,
        status: s.status,
        join_date: s.join_date,
        facility: s.facility_name ? { name: s.facility_name } : null,
      }));
      setEmployees(formattedSubs);
      setLoading(false);
    }
    load();
  }, [selectedFacilityId]);

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
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">部下管理</h1>
        <p className="text-xs text-diletto-gray-light">
          {selectedFacilityId
            ? `選択中の事業所の社員 ${employees.length} 名`
            : `全管轄事業所の社員 ${employees.length} 名（事業所セレクタで絞り込み可）`}
        </p>
      </div>

      {employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-diletto-gray">該当する社員がいません</p>
            <p className="text-sm text-diletto-gray-light mt-1">
              事業所セレクタを切り替えるか、管理者にお問い合わせください。
            </p>
          </CardContent>
        </Card>
      ) : (
        <SubordinateTable employees={employees as SubordinateRow[]} />
      )}
    </div>
  );
}
