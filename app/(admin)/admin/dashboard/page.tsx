'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ProgressDashboard } from '@/components/admin/ProgressDashboard';

export default function AdminDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me } = await supabase.from('employees').select('tenant_id').eq('auth_user_id', user.id).single();
      if (!me) return;

      const tid = me.tenant_id;

      const [progressRes, templatesRes, complianceRes, trainingsRes, announcementsRes, manualsRes, employeesRes, facilitiesRes, docSubsRes, compAcksRes, trainSubsRes, annReadsRes, manualReadsRes] = await Promise.all([
        supabase.from('employee_progress').select('*').eq('tenant_id', tid),
        supabase.from('document_templates').select('id').eq('tenant_id', tid),
        supabase.from('compliance_documents').select('id').eq('tenant_id', tid),
        supabase.from('trainings').select('id').eq('tenant_id', tid),
        supabase.from('announcements').select('id').eq('tenant_id', tid),
        supabase.from('manuals').select('id').eq('tenant_id', tid),
        supabase.from('employees').select('id, last_name, first_name, last_name_kana, first_name_kana, status, facility_id').eq('tenant_id', tid),
        supabase.from('facilities').select('id, name').eq('tenant_id', tid).order('created_at'),
        supabase.from('document_submissions').select('employee_id, submitted_at').eq('status', 'submitted'),
        supabase.from('compliance_acknowledgments').select('employee_id, acknowledged_at'),
        supabase.from('training_submissions').select('employee_id, submitted_at').eq('result', 'passed'),
        supabase.from('announcement_reads').select('employee_id, read_at'),
        supabase.from('manual_reads').select('employee_id, read_at'),
      ]);

      const empMap = new Map((employeesRes.data || []).map((e: any) => [e.id, e]));
      const rows = (progressRes.data || []).map((p: any) => {
        const emp = empMap.get(p.employee_id) || {};
        return { ...p, ...emp };
      });

      function buildLastMap(records: any[] | null | undefined, dateCol: string): Record<string, string> {
        const map: Record<string, string> = {};
        for (const r of records || []) {
          const ts = r[dateCol];
          if (!ts) continue;
          const cur = map[r.employee_id];
          if (!cur || ts > cur) map[r.employee_id] = ts;
        }
        return map;
      }

      const lastCompletedAt = {
        docs_submitted: buildLastMap(docSubsRes.data, 'submitted_at'),
        compliance_done: buildLastMap(compAcksRes.data, 'acknowledged_at'),
        trainings_passed: buildLastMap(trainSubsRes.data, 'submitted_at'),
        announcements_read: buildLastMap(annReadsRes.data, 'read_at'),
        manuals_read: buildLastMap(manualReadsRes.data, 'read_at'),
      };

      setData({
        rows,
        totalTemplates: templatesRes.data?.length || 0,
        totalCompliance: complianceRes.data?.length || 0,
        totalTrainings: trainingsRes.data?.length || 0,
        totalAnnouncements: announcementsRes.data?.length || 0,
        totalManuals: manualsRes.data?.length || 0,
        facilities: facilitiesRes.data || [],
        lastCompletedAt,
      });

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;
  if (!data) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ダッシュボード</h1>
      <ProgressDashboard {...data} />
    </div>
  );
}
