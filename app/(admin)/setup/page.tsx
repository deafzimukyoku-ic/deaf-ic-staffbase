'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SetupCompanyForm } from '@/components/admin/SetupCompanyForm';
import { SetupBankForm } from '@/components/admin/SetupBankForm';
import { SetupValuesForm } from '@/components/admin/SetupValuesForm';
import { toast } from 'sonner';

type Step = 'company' | 'bank' | 'values';

interface BankEntry {
  bank_name: string;
  is_default: boolean;
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>('company');
  const [loading, setLoading] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const [company, setCompany] = useState({
    company_name: '',
    representative_title: '',
    representative_name: '',
    representative_honorific: '様',
  });

  const [banks, setBanks] = useState<BankEntry[]>([]);

  const [values, setValues] = useState({
    company_philosophy: '',
    action_guidelines: '',
    core_values: '',
    valued_behaviors: '',
    avoided_behaviors: '',
    ideal_culture: '',
  });

  // 現在のテナント情報を取得
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: employee } = await supabase
        .from('employees')
        .select('tenant_id')
        .eq('auth_user_id', user.id)
        .single();

      if (!employee) return;
      setTenantId(employee.tenant_id);

      // 既存のテナント情報があればフォームに反映
      const { data: tenant } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', employee.tenant_id)
        .single();

      if (tenant) {
        setCompany({
          company_name: tenant.company_name || '',
          representative_title: tenant.representative_title || '',
          representative_name: tenant.representative_name || '',
          representative_honorific: tenant.representative_honorific || '様',
        });

        if (tenant.setup_completed_at) {
          router.push('/admin/dashboard');
        }
      }

      // 既存の銀行情報
      const { data: existingBanks } = await supabase
        .from('tenant_payroll_banks')
        .select('bank_name, is_default')
        .eq('tenant_id', employee.tenant_id)
        .order('display_order');

      if (existingBanks && existingBanks.length > 0) {
        setBanks(existingBanks);
      }
    }
    load();
  }, []);

  async function handleComplete() {
    if (!tenantId) return;
    setLoading(true);

    // 1. テナント情報更新
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({
        ...company,
        ...values,
        setup_completed_at: new Date().toISOString(),
      })
      .eq('id', tenantId);

    if (tenantErr) {
      toast.error('保存に失敗しました', { description: tenantErr.message });
      setLoading(false);
      return;
    }

    // 2. 銀行情報: 既存削除 → 再挿入
    await supabase
      .from('tenant_payroll_banks')
      .delete()
      .eq('tenant_id', tenantId);

    if (banks.length > 0) {
      const bankRows = banks
        .filter((b) => b.bank_name.trim())
        .map((b, i) => ({
          tenant_id: tenantId,
          bank_name: b.bank_name.trim(),
          display_order: i,
          is_default: b.is_default,
        }));

      if (bankRows.length > 0) {
        const { error: bankErr } = await supabase
          .from('tenant_payroll_banks')
          .insert(bankRows);

        if (bankErr) {
          toast.error('銀行情報の保存に失敗しました', { description: bankErr.message });
          setLoading(false);
          return;
        }
      }
    }

    toast.success('セットアップが完了しました');
    router.push('/admin/dashboard');
    router.refresh();
  }

  const steps: { key: Step; label: string; num: string }[] = [
    { key: 'company', label: '会社情報', num: '01' },
    { key: 'bank', label: '振込先銀行', num: '02' },
    { key: 'values', label: '会社価値観', num: '03' },
  ];

  const currentIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen bg-brand-beige py-12">
      <div className="mx-auto max-w-xl px-4">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">初期セットアップ</h1>
          <p className="mt-1 text-sm text-brand-gray">
            基本情報を設定してstaffbaseを始めましょう
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  i <= currentIndex
                    ? 'bg-brand-blue text-white'
                    : 'bg-[rgba(0,0,0,0.06)] text-brand-gray-light'
                }`}
              >
                {s.num}
              </div>
              <span
                className={`hidden text-xs font-medium sm:inline ${
                  i <= currentIndex ? 'text-[#111]' : 'text-brand-gray-light'
                }`}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div className={`mx-2 h-px w-8 ${i < currentIndex ? 'bg-brand-blue' : 'bg-black/10'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Forms */}
        {step === 'company' && (
          <SetupCompanyForm
            data={company}
            onChange={setCompany}
            onNext={() => setStep('bank')}
          />
        )}
        {step === 'bank' && (
          <SetupBankForm
            banks={banks}
            onChange={setBanks}
            onNext={() => setStep('values')}
            onBack={() => setStep('company')}
          />
        )}
        {step === 'values' && (
          <SetupValuesForm
            data={values}
            onChange={setValues}
            onSubmit={handleComplete}
            onBack={() => setStep('bank')}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}
