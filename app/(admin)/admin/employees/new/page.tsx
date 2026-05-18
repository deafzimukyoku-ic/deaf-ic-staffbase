'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { InviteUrlDialog } from '@/components/admin/InviteUrlDialog';
import { toast } from 'sonner';

interface Facility {
  id: string;
  name: string;
}

interface Position {
  id: string;
  name: string;
}

export default function NewEmployeePage() {
  const [loading, setLoading] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  /* Resend 送信失敗時に API が返してくる招待 URL を保持して
     InviteUrlDialog で表示する。閉じたら一覧へ遷移。 */
  const [pendingInviteLink, setPendingInviteLink] = useState<{ url: string; name: string } | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    email: '',
    employee_number: '',
    /* 基本勤務時間（シフト・送迎モードで初期表示する勤務時間と同じカラム）。
       /admin/shifts/staff-settings の DEFAULT_START_TIME / DEFAULT_END_TIME と一致させて初期値を入れておく。 */
    default_start_time: '09:30',
    default_end_time: '18:30',
    last_name: '',
    first_name: '',
    last_name_kana: '',
    first_name_kana: '',
    join_date: new Date().toISOString().split('T')[0],
    has_car_commute: false,
    is_shuttle_driver: false,
    facility_id: '',
    position_id: '',
    role: 'employee' as 'admin' | 'manager' | 'employee',
    manager_facility_ids: [] as string[],
  });

  function toggleManagerFacility(id: string) {
    setForm((prev) => {
      const exists = prev.manager_facility_ids.includes(id);
      return {
        ...prev,
        manager_facility_ids: exists
          ? prev.manager_facility_ids.filter((x) => x !== id)
          : [...prev.manager_facility_ids, id],
      };
    });
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase
        .from('employees')
        .select('tenant_id')
        .eq('auth_user_id', user.id)
        .single();
      if (me) {
        setTenantId(me.tenant_id);

        // 施設
        const { data: facs } = await supabase
          .from('facilities')
          .select('id, name')
          .eq('tenant_id', me.tenant_id)
          .order('name');
        setFacilities(facs || []);

        // 役職
        const { data: pos } = await supabase
          .from('positions')
          .select('id, name')
          .eq('tenant_id', me.tenant_id)
          .order('display_order');
        setPositions(pos || []);
      }
    }
    load();
  }, []);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;

    // manager は所属施設必須（manager_facilities 兼任設定の前提）
    if (form.role === 'manager' && !form.facility_id) {
      toast.error('マネージャーは所属施設の指定が必要です');
      return;
    }

    setLoading(true);

    const res = await fetch('/api/employees/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        employee_number: form.employee_number,
        last_name: form.last_name,
        first_name: form.first_name,
        last_name_kana: form.last_name_kana,
        first_name_kana: form.first_name_kana,
        join_date: form.join_date,
        has_car_commute: form.has_car_commute,
        is_shuttle_driver: form.is_shuttle_driver,
        facility_id: form.facility_id || null,
        position_id: form.position_id || null,
        role: form.role,
        manager_facility_ids: form.role === 'manager' ? form.manager_facility_ids : [],
        default_start_time: form.default_start_time || null,
        default_end_time: form.default_end_time || null,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      toast.error('社員の追加に失敗しました', { description: result.detail || result.error });
      setLoading(false);
      return;
    }

    if (result.warning) {
      toast.warning(result.warning);
    }

    if (result.resent) {
      toast.success(result.message || `${form.last_name} ${form.first_name} さんに招待メールを再送信しました`);
    } else {
      toast.success(`${form.last_name} ${form.first_name} さんを招待しました`);
    }

    /* Resend 失敗で inviteLink が返ってきたらダイアログ表示。
       閉じたタイミングで一覧へ遷移するため、ここでは push しない。 */
    if (result.inviteLink) {
      setPendingInviteLink({ url: result.inviteLink, name: `${form.last_name} ${form.first_name}` });
      setLoading(false);
      return;
    }

    router.push('/admin/employees');
    router.refresh();
  }

  return (
    <div className="pb-12">
      <h1 className="text-2xl font-bold mb-6">社員を追加</h1>

      <Card>
        <CardHeader>
          <CardTitle>招待情報</CardTitle>
          <CardDescription>社員にメールで招待リンクが送信されます</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">メールアドレス *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    required
                    placeholder="employee@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="number">従業員番号 *</Label>
                  <Input
                    id="number"
                    value={form.employee_number}
                    onChange={(e) => update('employee_number', e.target.value)}
                    required
                    placeholder="EMP-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>基本勤務時間</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label="基本勤務開始時刻"
                      value={form.default_start_time}
                      onChange={(e) => update('default_start_time', e.target.value)}
                      className="flex-1"
                    />
                    <span className="text-sm text-muted-foreground">〜</span>
                    <Input
                      type="time"
                      aria-label="基本勤務終了時刻"
                      value={form.default_end_time}
                      onChange={(e) => update('default_end_time', e.target.value)}
                      className="flex-1"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    シフト・送迎表モードの初期勤務時間として使われます。後から職員管理で変更できます。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="last_name">姓 *</Label>
                    <Input
                      id="last_name"
                      value={form.last_name}
                      onChange={(e) => update('last_name', e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="first_name">名 *</Label>
                    <Input
                      id="first_name"
                      value={form.first_name}
                      onChange={(e) => update('first_name', e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="last_name_kana">姓（カナ） *</Label>
                    <Input
                      id="last_name_kana"
                      value={form.last_name_kana}
                      onChange={(e) => update('last_name_kana', e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="first_name_kana">名（カナ） *</Label>
                    <Input
                      id="first_name_kana"
                      value={form.first_name_kana}
                      onChange={(e) => update('first_name_kana', e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="join_date">入社日 *</Label>
                  <Input
                    id="join_date"
                    type="date"
                    value={form.join_date}
                    onChange={(e) => update('join_date', e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="facility_id">所属施設</Label>
                  <select
                    id="facility_id"
                    title="所属施設を選択"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    value={form.facility_id}
                    onChange={(e) => update('facility_id', e.target.value)}
                  >
                    <option value="">選択してください</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="position_id">役職</Label>
                  <select
                    id="position_id"
                    title="役職を選択"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    value={form.position_id}
                    onChange={(e) => update('position_id', e.target.value)}
                  >
                    <option value="">選択してください</option>
                    {positions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">アプリ権限 *</Label>
                  <select
                    id="role"
                    title="アプリ権限を選択"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    value={form.role}
                    onChange={(e) => update('role', e.target.value as 'admin' | 'manager' | 'employee')}
                  >
                    <option value="employee">職員（自分の情報のみ）</option>
                    <option value="manager">マネージャー（所属事業所の管理）</option>
                    <option value="admin">管理者（全事業所の管理）</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    後から「アクセス権マトリクス」画面で変更できます。
                  </p>
                </div>

                {form.role === 'manager' && (
                  <div className="space-y-2">
                    <Label>追加担当施設（任意）</Label>
                    <p className="text-xs text-muted-foreground">
                      所属施設に加えて管理できる事業所を選択。後からも変更できます。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {facilities
                        .filter((f) => f.id !== form.facility_id)
                        .map((f) => {
                          const checked = form.manager_facility_ids.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => toggleManagerFacility(f.id)}
                              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                checked
                                  ? 'bg-brand-blue text-white border-brand-blue'
                                  : 'bg-white text-brand-gray border-brand-gray/20 hover:bg-brand-beige'
                              }`}
                            >
                              {f.name} {checked ? '✓' : ''}
                            </button>
                          );
                        })}
                      {facilities.filter((f) => f.id !== form.facility_id).length === 0 && (
                        <span className="text-xs text-muted-foreground">他の事業所がありません</span>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>

            <div className="border-t pt-6">
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.has_car_commute}
                    onChange={(e) => update('has_car_commute', e.target.checked)}
                    className="rounded h-4 w-4 accent-brand-blue"
                  />
                  <span className="text-sm">自家用車通勤あり</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_shuttle_driver}
                    onChange={(e) => update('is_shuttle_driver', e.target.checked)}
                    className="rounded h-4 w-4 accent-brand-blue"
                  />
                  <span className="text-sm">送迎ドライバー</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                className="w-32"
                onClick={() => router.push('/admin/employees')}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={loading} className="flex-1 bg-brand-ink hover:bg-black text-white font-bold">
                {loading ? '招待中...' : '招待メールを送信'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ※ 招待リンクは送信から約1時間で失効します。期限切れになった場合は社員一覧から再送信できます。
            </p>
          </form>
        </CardContent>
      </Card>

      <InviteUrlDialog
        open={!!pendingInviteLink}
        url={pendingInviteLink?.url ?? null}
        employeeName={pendingInviteLink?.name}
        onClose={() => {
          setPendingInviteLink(null);
          router.push('/admin/employees');
          router.refresh();
        }}
      />
    </div>
  );
}
