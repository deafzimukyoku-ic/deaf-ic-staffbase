'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ProgressDashboard } from '@/components/admin/ProgressDashboard';
import { NotificationsAlertModal } from '@/components/notifications/NotificationsAlertModal';
import { isEmployeeInAudience, loadTemplateAudience } from '@/lib/template-audience';
import { isItemInAudience } from '@/lib/multi-facility';
import type { Employee, DocumentTemplate, TargetType } from '@/lib/types';

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

      /* dashboard-published-filter:
         遵守事項 / 研修 / お知らせ / 業務マニュアル は全件と公開件数を別々に取得する。
         公開件数 = 達成率分母・ProgressBadge total / 全件 = 概要カード「公開 / 全件」表示の右側 */
      const [progressRes, templatesRes, complianceRes, complianceAllRes, trainingsRes, trainingsAllRes, announcementsRes, announcementsAllRes, manualsRes, manualsAllRes, employeesRes, facilitiesRes, docSubsRes, compAcksRes, trainSubsRes, annReadsRes, manualReadsRes, empFacilitiesRes] = await Promise.all([
        supabase.from('employee_progress').select('*').eq('tenant_id', tid),
        /* mapping も含めて取得 — 社員別の対象書類数を計算するため */
        supabase.from('document_templates').select('id, mapping').eq('tenant_id', tid),
        /* 4 機能は target_type/facility_ids/position_ids も取得して per-employee の分母計算に使う。
           旧コードは tenant 全件 (id だけ) を全社員に共通分母にしていたため、他施設限定アイテムや
           position 限定アイテムが「対象外社員」の達成率分母に入って永遠に下がる問題があった。 */
        supabase.from('compliance_documents').select('id, target_type, target_facility_ids, target_position_ids').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('compliance_documents').select('id').eq('tenant_id', tid),
        supabase.from('trainings').select('id, target_type, target_facility_ids, target_position_ids').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('trainings').select('id').eq('tenant_id', tid),
        supabase.from('announcements').select('id, target_type, target_facility_ids, target_position_ids').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('announcements').select('id').eq('tenant_id', tid),
        supabase.from('manuals').select('id, target_type, target_facility_ids, target_position_ids').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('manuals').select('id').eq('tenant_id', tid),
        /* gate 判定に必要な employee 列 + 進捗一覧並び替え用 employee_number + position_id (audience 判定用)。
           171 以降 shift_manager は進捗一覧から除外 */
        supabase.from('employees').select('id, employee_number, last_name, first_name, last_name_kana, first_name_kana, status, facility_id, position_id, has_car_commute, is_shuttle_driver').eq('tenant_id', tid).neq('role', 'shift_manager'),
        supabase.from('facilities').select('id, name').eq('tenant_id', tid).order('display_order', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('document_submissions').select('employee_id, submitted_at').eq('status', 'submitted'),
        supabase.from('compliance_acknowledgments').select('employee_id, acknowledged_at'),
        supabase.from('training_submissions').select('employee_id, submitted_at').eq('result', 'passed'),
        supabase.from('announcement_reads').select('employee_id, read_at'),
        supabase.from('manual_reads').select('employee_id, read_at'),
        /* 兼任 (migration 130/131): 各社員の追加所属 facility を一括取得 */
        supabase.from('employee_facilities').select('employee_id, facility_id'),
      ]);

      /* 社員別の対象書類数を事前計算（migration 122: 書類テンプレ配布対象ルールベース）。
         ルール 0 件 = 全員対象、ルール 1 件以上 = いずれかに該当（OR）。 */
      const allTemplates = (templatesRes.data || []) as Pick<DocumentTemplate, 'id' | 'mapping'>[];
      const tplIds = allTemplates.map((t) => t.id);
      const audienceByTemplate = await loadTemplateAudience(supabase, tplIds);
      const docTotalsByEmployee: Record<string, number> = {};
      for (const emp of (employeesRes.data || []) as Employee[]) {
        let count = 0;
        for (const tpl of allTemplates) {
          if (isEmployeeInAudience(tpl.id, emp, audienceByTemplate)) count++;
        }
        docTotalsByEmployee[emp.id] = count;
      }

      /* 4 機能 (compliance/training/announcement/manual) も社員別の対象数を per-employee で計算する。
         旧コードは tenant 全公開件数を全社員共通の分母にしていたため、配信対象外アイテムが
         達成率を下げていた。isItemInAudience で「自分の facility (兼任含む) + position に
         該当するアイテム数」を社員ごとに算出する。 */
      type AudRow = { id: string; target_type: TargetType; target_facility_ids: string[] | null; target_position_ids: string[] | null };
      const audCompliance = (complianceRes.data ?? []) as AudRow[];
      const audTrainings = (trainingsRes.data ?? []) as AudRow[];
      const audAnnouncements = (announcementsRes.data ?? []) as AudRow[];
      const audManuals = (manualsRes.data ?? []) as AudRow[];

      /* 兼任 facility を employee_id → facility_ids[] でマップ化 */
      const efByEmp = new Map<string, string[]>();
      for (const r of (empFacilitiesRes.data ?? []) as { employee_id: string; facility_id: string }[]) {
        const arr = efByEmp.get(r.employee_id) ?? [];
        arr.push(r.facility_id);
        efByEmp.set(r.employee_id, arr);
      }

      const publishedTotalsByEmployee: Record<string, { compliance: number; trainings: number; announcements: number; manuals: number }> = {};
      for (const emp of (employeesRes.data || []) as (Employee & { position_id?: string | null })[]) {
        const myFacilityIds: string[] = [];
        if (emp.facility_id) myFacilityIds.push(emp.facility_id);
        for (const f of efByEmp.get(emp.id) ?? []) {
          if (!myFacilityIds.includes(f)) myFacilityIds.push(f);
        }
        const myPositionId = (emp.position_id as string | null) ?? null;
        publishedTotalsByEmployee[emp.id] = {
          compliance: audCompliance.filter((r) => isItemInAudience(r, myFacilityIds, myPositionId)).length,
          trainings: audTrainings.filter((r) => isItemInAudience(r, myFacilityIds, myPositionId)).length,
          announcements: audAnnouncements.filter((r) => isItemInAudience(r, myFacilityIds, myPositionId)).length,
          manuals: audManuals.filter((r) => isItemInAudience(r, myFacilityIds, myPositionId)).length,
        };
      }

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
        docTotalsByEmployee,
        publishedTotalsByEmployee,
        publishedTotals: {
          compliance: complianceRes.data?.length || 0,
          trainings: trainingsRes.data?.length || 0,
          announcements: announcementsRes.data?.length || 0,
          manuals: manualsRes.data?.length || 0,
        },
        allTotals: {
          compliance: complianceAllRes.data?.length || 0,
          trainings: trainingsAllRes.data?.length || 0,
          announcements: announcementsAllRes.data?.length || 0,
          manuals: manualsAllRes.data?.length || 0,
        },
        facilities: facilitiesRes.data || [],
        lastCompletedAt,
      });

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;
  if (!data) return null;

  return (
    <div>
      <NotificationsAlertModal />
      <h1 className="text-2xl font-bold mb-6">ダッシュボード</h1>
      <ProgressDashboard {...data} />
    </div>
  );
}
