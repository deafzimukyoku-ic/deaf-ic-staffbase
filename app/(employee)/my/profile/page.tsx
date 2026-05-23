'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileSection1Basic } from '@/components/employee/ProfileSection1Basic';
import { ProfileSectionCommute } from '@/components/employee/ProfileSectionCommute';
import { ProfileSectionContacts } from '@/components/employee/ProfileSectionContacts';
import { PushSubscriptionSection } from '@/components/profile/PushSubscriptionSection';
import { toast } from 'sonner';
import type { Employee, CustomEmployeeField } from '@/lib/types';

const TABS = [
  { value: 'basic', label: '基本', icon: '👤' },
  { value: 'commute', label: '通勤・車両', icon: '🚗' },
  { value: 'contacts', label: '連絡先', icon: '📞' },
] as const;

export default function ProfilePage() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  /* カスタム項目はここで一回だけロードして section でフィルタした配列を各タブに渡す。
     旧実装は ProfileSection1Basic 内で fetch していたが、3 タブに分散すると 3 回 fetch になるので親側に集約。 */
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomEmployeeField[]>([]);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('employees')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();

      if (data) {
        setEmployee(data as Employee);
        const { data: cfs } = await supabase
          .from('custom_employee_fields')
          .select('*')
          .eq('tenant_id', data.tenant_id)
          .eq('is_active', true)
          .order('display_order');
        if (cfs) setCustomFieldDefs(cfs as CustomEmployeeField[]);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!employee) return;
    setSaving(true);

    const { error } = await supabase
      .from('employees')
      .update(employee)
      .eq('id', employee.id);

    if (error) {
      toast.error('保存に失敗しました', { description: error.message });
      setSaving(false);
      return;
    }

    toast.success('基本情報を保存しました');
    setSaving(false);
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;
  if (!employee) return <p className="text-brand-red">プロフィールが見つかりません</p>;

  function updateSection<T>(sectionData: T) {
    setEmployee((prev) => prev ? { ...prev, ...sectionData } : null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-xl sm:text-2xl font-bold">基本情報</h1>
        <Button onClick={handleSave} disabled={saving} className="shrink-0">
          {saving ? '保存中...' : '保存する'}
        </Button>
      </div>

      <PushSubscriptionSection />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex w-full overflow-x-auto no-scrollbar">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 flex-1 text-xs sm:text-sm px-2 sm:px-3">
              <span className="mr-1">{tab.icon}</span>{tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="basic">
          <ProfileSection1Basic
            data={{
              last_name: employee.last_name, first_name: employee.first_name,
              last_name_kana: employee.last_name_kana, first_name_kana: employee.first_name_kana,
              birth_date: employee.birth_date, gender: employee.gender,
              postal_code: employee.postal_code, address: employee.address, phone: employee.phone,
              position: employee.position,
              years_of_service: employee.years_of_service, job_type: employee.job_type,
              work_location: employee.work_location, facility_id: employee.facility_id, join_date: employee.join_date,
              default_start_time: employee.default_start_time, default_end_time: employee.default_end_time,
              my_number: employee.my_number, previous_employer: employee.previous_employer,
              qualifications: employee.qualifications, custom_fields: employee.custom_fields,
              bank_name: employee.bank_name, bank_branch_name: employee.bank_branch_name,
              bank_account_type: employee.bank_account_type, bank_account_number: employee.bank_account_number,
              bank_account_holder: employee.bank_account_holder,
            }}
            employeeId={employee.id}
            customFieldDefs={customFieldDefs.filter((f) => f.section === 'basic')}
            onChange={updateSection}
          />
        </TabsContent>

        <TabsContent value="commute">
          <ProfileSectionCommute
            data={{
              has_car_commute: employee.has_car_commute, is_shuttle_driver: employee.is_shuttle_driver,
              car_model: employee.car_model, car_plate_number: employee.car_plate_number,
              license_type: employee.license_type, license_number: employee.license_number,
              license_expiry: employee.license_expiry,
              insurance_company: employee.insurance_company,
              insurance_policy_number: employee.insurance_policy_number,
              insurance_expiry: employee.insurance_expiry,
              vehicle_inspection_expiry: employee.vehicle_inspection_expiry,
              commute_distance: employee.commute_distance,
              driving_experience: employee.driving_experience, accident_history: employee.accident_history,
              training_attendance: employee.training_attendance,
              license_image_path: employee.license_image_path,
              license_image_back_path: employee.license_image_back_path,
              commute_route_image_path: employee.commute_route_image_path,
              commute_method: employee.commute_method, commute_time_minutes: employee.commute_time_minutes,
              route_section1_route: employee.route_section1_route, route_section1_transport: employee.route_section1_transport, route_section1_cost: employee.route_section1_cost,
              route_section2_route: employee.route_section2_route, route_section2_transport: employee.route_section2_transport, route_section2_cost: employee.route_section2_cost,
              commute_route_detail: employee.commute_route_detail,
              custom_fields: employee.custom_fields,
            }}
            employeeId={employee.id}
            customFieldDefs={customFieldDefs.filter((f) => f.section === 'commute')}
            onChange={updateSection}
          />
        </TabsContent>

        <TabsContent value="contacts">
          <ProfileSectionContacts
            data={{
              emergency1_name: employee.emergency1_name, emergency1_relationship: employee.emergency1_relationship,
              emergency1_phone: employee.emergency1_phone, emergency1_mobile: employee.emergency1_mobile,
              emergency1_postal_code: employee.emergency1_postal_code, emergency1_address: employee.emergency1_address,
              emergency2_name: employee.emergency2_name, emergency2_relationship: employee.emergency2_relationship,
              emergency2_phone: employee.emergency2_phone, emergency2_mobile: employee.emergency2_mobile,
              emergency2_postal_code: employee.emergency2_postal_code, emergency2_address: employee.emergency2_address,
              guarantor_name: employee.guarantor_name, guarantor_birth_date: employee.guarantor_birth_date,
              guarantor_postal_code: employee.guarantor_postal_code, guarantor_address: employee.guarantor_address,
              guarantor_phone: employee.guarantor_phone, guarantor_relationship: employee.guarantor_relationship,
              custom_fields: employee.custom_fields,
            }}
            employeeId={employee.id}
            customFieldDefs={customFieldDefs.filter((f) => f.section === 'contacts')}
            onChange={updateSection}
          />
        </TabsContent>
      </Tabs>

      {/* セクションナビゲーション */}
      {(() => {
        const idx = TABS.findIndex((t) => t.value === activeTab);
        const prev = idx > 0 ? TABS[idx - 1] : null;
        const next = idx < TABS.length - 1 ? TABS[idx + 1] : null;
        const isLast = idx === TABS.length - 1;

        return (
          <div className="mt-8 flex items-center justify-between border-t border-brand-gray/10 pt-6">
            {prev ? (
              <button
                onClick={() => { setActiveTab(prev.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="group flex items-center gap-2 text-sm text-brand-gray hover:text-brand-ink transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-1">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>{prev.icon} {prev.label}</span>
              </button>
            ) : <div />}

            <div className="flex items-center gap-1.5">
              {TABS.map((tab, i) => (
                <button
                  key={tab.value}
                  onClick={() => { setActiveTab(tab.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className={`rounded-full transition-all duration-300 ${i === idx ? 'w-6 h-2 bg-brand-blue' : 'w-2 h-2 bg-brand-gray/20 hover:bg-brand-gray/40'}`}
                  title={tab.label}
                />
              ))}
            </div>

            {isLast ? (
              <Button onClick={handleSave} disabled={saving} variant="gold">
                {saving ? '保存中...' : '💾 保存する'}
              </Button>
            ) : next ? (
              <button
                onClick={() => { setActiveTab(next.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="group flex items-center gap-2 text-sm font-medium text-brand-blue hover:text-brand-ink transition-colors"
              >
                <span>{next.icon} {next.label}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ) : <div />}
          </div>
        );
      })()}
    </div>
  );
}
