// シフト・送迎ダッシュボード（manager）
// 担当facility のみ集計。UI は admin 版と同じ。

import { createClient } from '@/lib/supabase/server';
import DashboardCardsGrid, {
  type DashboardCard,
  type DashboardCardKey,
  type DashboardStatus,
} from '@/components/shift/DashboardCardsGrid';

export const dynamic = 'force-dynamic';

type Status = DashboardStatus;
type CardKey = DashboardCardKey;

const MANAGER_CARDS: DashboardCard[] = [
  /* 業務 */
  { href: '/mgr/shifts/schedule', title: '利用表', desc: 'PDFインポート・カレンダー確認', icon: '📅', key: 'schedule' },
  { href: '/mgr/shifts', title: 'シフト表', desc: 'シフト生成・調整・公開', icon: '📋', key: 'shift' },
  { href: '/mgr/shifts/transport', title: '送迎表', desc: '担当割り当て・公開', icon: '🚗', key: 'transport' },
  /* 出力 */
  { href: '/mgr/shifts/output/daily', title: '日次出力', desc: '当日の送迎・出勤をホワイトボード風に表示', icon: '📄' },
  { href: '/mgr/shifts/output/daily-report', title: '業務日報', desc: '当日の業務内容を A4 で出力', icon: '📋' },
  { href: '/mgr/shifts/output/billing', title: '利用料金表', desc: '月次の請求書を生成・印刷', icon: '💰' },
  /* 申請 */
  { href: '/mgr/requests', title: '休み希望一覧', desc: '担当事業所の提出状況を確認', icon: '✋', key: 'request' },
  /* シフト設定 */
  { href: '/mgr/shifts/facility-settings', title: '事業所設定', desc: 'コアタイム・エリア・最低出勤数', icon: '🏢' },
  { href: '/mgr/shifts/staff-settings', title: '職員管理', desc: '出勤予定・有資格者・送迎エリア', icon: '👔' },
  { href: '/mgr/children', title: '児童管理', desc: '学年・上限負担額・教材印刷代', icon: '👶' },
  { href: '/mgr/shifts/events', title: 'イベント設定', desc: '月次の有料イベント登録', icon: '🎉' },
];

async function computeStatuses(
  tenantId: string,
  facilityId: string,
  targetMonthStr: string,
  monthFrom: string,
  monthTo: string
): Promise<Record<CardKey, Status>> {
  const supabase = await createClient();
  const result: Record<CardKey, Status> = {
    schedule: 'empty',
    shift: 'empty',
    transport: 'empty',
    request: 'empty',
  };

  const { data: entries } = await supabase
    .from('schedule_entries')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('facility_id', facilityId)
    .gte('date', monthFrom)
    .lte('date', monthTo);
  const entryIds = (entries ?? []).map((e) => e.id);
  result.schedule = entryIds.length > 0 ? 'complete' : 'empty';

  const { data: sRows } = await supabase
    .from('shift_assignments')
    .select('publish_status')
    .eq('tenant_id', tenantId)
    .eq('facility_id', facilityId)
    .gte('date', monthFrom)
    .lte('date', monthTo);
  const sList = (sRows ?? []) as { publish_status: string }[];
  if (sList.length === 0) result.shift = 'empty';
  else if (sList.every((r) => r.publish_status === 'published')) result.shift = 'complete';
  else result.shift = 'incomplete';

  if (entryIds.length > 0) {
    const { data: tRows } = await supabase
      .from('transport_assignments')
      .select('publish_status')
      .in('schedule_entry_id', entryIds);
    const tList = (tRows ?? []) as { publish_status: string }[];
    if (tList.length === 0) result.transport = 'empty';
    else if (tList.every((r) => r.publish_status === 'published')) result.transport = 'complete';
    else result.transport = 'incomplete';
  }

  const { data: activeEmps } = await supabase
    .from('employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('facility_id', facilityId)
    .eq('status', 'active')
    .neq('role', 'admin');
  const totalStaff = (activeEmps ?? []).length;
  if (totalStaff > 0) {
    const { data: reqRows } = await supabase
      .from('shift_requests')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('facility_id', facilityId)
      .eq('month', targetMonthStr);
    const submitted = new Set((reqRows ?? []).map((r) => r.employee_id));
    result.request = submitted.size === 0 ? 'empty'
      : submitted.size >= totalStaff ? 'complete'
      : 'incomplete';
  }

  return result;
}

export default async function ManagerShiftsDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let tenantId: string | null = null;
  let facilityId: string | null = null;
  let userName = '';
  if (user) {
    const { data: emp } = await supabase
      .from('employees')
      .select('last_name, first_name, tenant_id, facility_id')
      .eq('auth_user_id', user.id)
      .single();
    if (emp) {
      tenantId = emp.tenant_id;
      facilityId = emp.facility_id;
      userName = `${emp.last_name} ${emp.first_name}`.trim();
    }
  }

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const targetMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthFrom = `${targetMonthStr}-01`;
  const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
  const monthTo = `${targetMonthStr}-${String(lastDay).padStart(2, '0')}`;

  const statuses = tenantId && facilityId
    ? await computeStatuses(tenantId, facilityId, targetMonthStr, monthFrom, monthTo)
    : { schedule: 'empty' as Status, shift: 'empty' as Status, transport: 'empty' as Status, request: 'empty' as Status };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-md border border-diletto-gray/10 p-6 shadow-sm">
        <h1 className="text-xl font-bold text-diletto-ink mb-1">
          こんにちは{userName ? `、${userName} さん` : ''}
        </h1>
        <p className="text-sm text-diletto-gray">
          マネージャーモード: 担当事業所のシフト・送迎を管理できます
        </p>
      </div>

      <DashboardCardsGrid cards={MANAGER_CARDS} statuses={statuses} scope="manager" />
    </div>
  );
}
