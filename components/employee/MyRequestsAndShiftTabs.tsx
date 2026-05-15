'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MyRequestsView from '@/components/shift/MyRequestsView';
import MyFacilityShiftView from '@/components/employee/MyFacilityShiftView';

/**
 * 社員の「休み希望」ページ内タブ切替:
 *   - 休み希望タブ (デフォルト): 来月の希望提出 (既存 MyRequestsView)
 *   - 施設のシフト タブ: 今月の facility 全社員シフト表 (新規 MyFacilityShiftView)
 *
 * 親 page.tsx は server component で auth check を行い、props で渡す。
 * このコンポーネントは client-only で Tabs 状態を保持。
 */
interface Props {
  employeeId: string;
  tenantId: string;
  facilityId: string;
}

export default function MyRequestsAndShiftTabs({ employeeId, tenantId, facilityId }: Props) {
  return (
    <Tabs defaultValue="requests" className="w-full">
      <TabsList className="bg-diletto-beige/40 border border-diletto-gray/10 rounded-xl h-10 p-1 gap-1">
        <TabsTrigger
          value="requests"
          className="px-4 text-sm font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:font-bold"
        >
          休み希望（来月）
        </TabsTrigger>
        <TabsTrigger
          value="facility-shift"
          className="px-4 text-sm font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:font-bold"
        >
          施設のシフト（今月）
        </TabsTrigger>
      </TabsList>

      <TabsContent value="requests" className="mt-4">
        <MyRequestsView employeeId={employeeId} tenantId={tenantId} facilityId={facilityId} />
      </TabsContent>

      <TabsContent value="facility-shift" className="mt-4">
        <MyFacilityShiftView employeeId={employeeId} tenantId={tenantId} facilityId={facilityId} />
      </TabsContent>
    </Tabs>
  );
}
