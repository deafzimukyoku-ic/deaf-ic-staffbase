'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MyRequestsView from '@/components/shift/MyRequestsView';
import MyFacilityShiftView from '@/components/employee/MyFacilityShiftView';

/**
 * 社員の「休み希望（+シフト）」ページ内タブ切替:
 *   - 休み希望 (来月): 既存 MyRequestsView
 *   - 施設のシフト (今月): 新規 MyFacilityShiftView (read-only 全社員表)
 *
 * 旧 /my/shifts ページ + MyShiftsView (自分のシフト + 個別変更申請) は撤廃。
 * /my/shifts URL は /my/requests?tab=facility-shift にリダイレクト。
 *
 * URL クエリ `?tab=...` で初期タブを切替可:
 *   - tab=requests (省略時)   : 休み希望
 *   - tab=facility-shift      : 施設のシフト
 *
 * 親 page.tsx は server component で auth check を行い、props で渡す。
 */
interface Props {
  employeeId: string;
  tenantId: string;
  facilityId: string;
}

type TabValue = 'requests' | 'facility-shift';
const VALID_TABS: TabValue[] = ['requests', 'facility-shift'];

export default function MyRequestsAndShiftTabs({ employeeId, tenantId, facilityId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as TabValue | null;
  const activeTab: TabValue = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'requests';

  const handleTabChange = (next: string) => {
    /* URL クエリを書き換えてタブ状態を保持する (リロード/共有時にも維持) */
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'requests') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="bg-diletto-beige/40 border border-diletto-gray/10 rounded-xl h-10 p-1 gap-1">
        <TabsTrigger
          value="requests"
          className="px-3 sm:px-4 text-sm font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:font-bold"
        >
          休み希望（来月）
        </TabsTrigger>
        <TabsTrigger
          value="facility-shift"
          className="px-3 sm:px-4 text-sm font-semibold rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:font-bold"
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
