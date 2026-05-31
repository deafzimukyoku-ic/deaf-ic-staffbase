'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { applyScopeFilter } from '@/components/admin/FacilityScopeSelector';
import { fetchMyFacilityIds, isItemInAudience } from '@/lib/multi-facility';
import type { TargetType, DocumentTemplate, PdfTag } from '@/lib/types';
import { extractReferencedEmployeeFields, needsResubmitBySnapshot } from '@/lib/document-resubmit';

interface TodoItem {
  label: string;
  href: string;
  done: boolean;
  current: number;
  total: number;
  icon: string;
  /* 提出済みのうち基本情報変更後の「要再提出」件数（書類カード専用） */
  resubmitCount?: number;
  /* 個別連絡カード専用: 未読件数 (赤バッジ用) */
  messageUnread?: number;
  /* シフトカード専用: 対象月の出勤予定日数 (進捗計算には使わない情報表示用) */
  shiftPlannedDays?: number;
  /* シフトカード専用: 表示・深リンク対象の月 (今月 or 来月) */
  shiftMonthNum?: number;
  /* シフトカード専用: 未確認の (施設,月) 件数 (赤バッジ用) */
  shiftUnconfirmed?: number;
}

type UpdateKind = 'announcement' | 'compliance' | 'training' | 'manual';
interface UpdateItem {
  kind: UpdateKind;
  id: string;
  title: string;
  createdAt: string;
  href: string;
  icon: string;
  label: string;
}

const HERO_DAYS = 7;

function daysAgoLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDay === 0) return '今日';
  if (diffDay === 1) return '1日前';
  return `${diffDay}日前`;
}

export default function EmployeeDashboardPage() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatesExpanded, setUpdatesExpanded] = useState(false);
  const supabase = createClient();
  const UPDATES_PREVIEW = 5;

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: me } = await supabase
        .from('employees')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();

      if (!me) return;
      setName(`${me.last_name} ${me.first_name}`);

      const tid = me.tenant_id;
      const eid = me.id;

      // 入力チェック
      const isFilled = (v: unknown) => v != null && String(v).trim() !== '';
      const isArrayFilled = (v: unknown) => Array.isArray(v) && v.length > 0;

      /* 基本情報（/my/profile の 3 タブ: basic / commute / contacts の全項目）
         ProfileSection1Basic + ProfileSectionCommute + ProfileSectionContacts に
         レンダされる全フィールドをカバーする。条件付きフィールドは
         lib/field-applicability.ts の CORE_FIELD_GATES と同じ条件で必要時だけ計上。 */
      const basicFields: unknown[] = [
        // 個人情報
        me.last_name, me.first_name, me.last_name_kana, me.first_name_kana,
        me.birth_date, me.gender, me.postal_code, me.address, me.phone,
        // 雇用情報
        me.position, me.years_of_service, me.job_type, me.work_location,
        me.facility_id, me.join_date,
        // マイナンバー / 前職
        me.my_number, me.previous_employer,
        // 銀行
        me.bank_name, me.bank_branch_name, me.bank_account_type,
        me.bank_account_number, me.bank_account_holder,
        // 通勤手段選択 + 通勤経路画像
        me.commute_method, me.commute_route_image_path,
        // 緊急連絡先1
        me.emergency1_name, me.emergency1_relationship, me.emergency1_phone,
        me.emergency1_mobile, me.emergency1_postal_code, me.emergency1_address,
        // 緊急連絡先2（任意、未入力でも計上対象）
        me.emergency2_name, me.emergency2_relationship, me.emergency2_phone,
        me.emergency2_mobile, me.emergency2_postal_code, me.emergency2_address,
        // 保証人
        me.guarantor_name, me.guarantor_relationship, me.guarantor_phone,
        me.guarantor_postal_code, me.guarantor_address, me.guarantor_birth_date,
      ];
      // qualifications: 配列で 1 件以上あれば 1 カウント
      const qualFilled = isArrayFilled(me.qualifications) ? 1 : 0;
      const qualTotal = 1;

      // 通勤詳細（公共交通機関を選んだ人のみ計上）
      const publicTransportFields: unknown[] = me.commute_method === 'public_transport'
        ? [
            me.commute_time_minutes, me.commute_distance,
            me.route_section1_route, me.route_section1_transport, me.route_section1_cost,
            me.commute_route_detail,
          ]
        : [];

      // 免許情報（マイカー OR 送迎運転者）
      const needsLicense = !!(me.has_car_commute || me.is_shuttle_driver);
      const licenseFields: unknown[] = needsLicense
        ? [me.license_type, me.license_number, me.license_expiry, me.license_image_path]
        : [];

      // マイカー車両情報
      const carFields: unknown[] = me.has_car_commute
        ? [
            me.car_model, me.car_plate_number,
            me.insurance_company, me.insurance_policy_number, me.insurance_expiry,
            me.vehicle_inspection_expiry,
          ]
        : [];

      // 送迎運転者の運転情報
      const shuttleFields: unknown[] = me.is_shuttle_driver
        ? [me.driving_experience, me.accident_history, me.training_attendance]
        : [];

      const allBasicFlat = [...basicFields, ...publicTransportFields, ...licenseFields, ...carFields, ...shuttleFields];
      const basicFilled = allBasicFlat.filter(isFilled).length + qualFilled;
      const basicTotal = allBasicFlat.length + qualTotal;

      /* 自己紹介（/my/about の 6 セクション全フィールド: 6+6+6+12+8+4 = 42 項目） */
      const aboutFields: unknown[] = [
        // Section2 (intro)
        me.self_introduction, me.current_duties, me.past_duties,
        me.efforts_focused_on, me.how_others_describe, me.values_and_motivation,
        // Section3 (workstyle)
        me.work_style_solo_vs_team, me.work_style_clear_vs_autonomy,
        me.work_style_stable_vs_change, me.work_style_think_vs_act,
        me.multitask_ability, me.detail_orientation,
        // Section4 (comm)
        me.comm_conclusion_vs_context, me.comm_consult_timing,
        me.comm_feedback_preference, me.comm_channel_preference,
        me.meeting_behavior, me.relationship_notes,
        // Section5 (strengths) — 12 項目すべて
        me.strength_1, me.strength_2, me.strength_3,
        me.weakness_1, me.weakness_2, me.weakness_3,
        me.success_experience, me.success_reason,
        me.struggle_experience, me.struggle_reason,
        me.suited_tasks, me.burden_tasks,
        // Section6 (values) — 8 項目すべて
        me.workplace_values, me.ideal_boss_colleague, me.disliked_atmosphere,
        me.growth_goal, me.preferred_evaluation, me.safe_environment,
        me.strengths_self_reported, me.work_style_preference,
        // Section7 (team)
        me.team_role_preference, me.easy_to_work_with,
        me.hard_to_work_with, me.team_mindset,
      ];
      const aboutFilled = aboutFields.filter(isFilled).length;
      const aboutTotal = aboutFields.length;

      // 来月の YYYY-MM
      const now = new Date();
      const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;

      // 今月の YYYY-MM (シフトカード用)
      const thisMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthFrom = `${thisMonthDate.getFullYear()}-${String(thisMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
      const thisMonthKey = `${thisMonthDate.getFullYear()}-${String(thisMonthDate.getMonth() + 1).padStart(2, '0')}`;
      // 来月末まで範囲を広げる（シフトは通常「翌月分」を先に公開するため、今月が未公開でも来月を見る）
      const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      const nextMonthTo = `${nextMonthEnd.getFullYear()}-${String(nextMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(nextMonthEnd.getDate()).padStart(2, '0')}`;

      const [templates, submissions, compliance, compAcks, trainings, trainSubs, announcements, annViewLogs, manuals, manualViewLogs, shiftReqs, threadMembers, messageReads, shiftPlanned] = await Promise.all([
        /* 175 同期: /my/documents と同じ列を取得して同じ filter + snapshot 判定を回す。
           id だけだと audience / is_company_issued / matrix 除外ができず、tTotal/tDone がズレる。 */
        supabase.from('document_templates').select('id, template_type, data_mode, is_company_issued, mapping').eq('tenant_id', tid),
        /* submitted_at + employee_snapshot を取得して needsResubmitBySnapshot にかける */
        supabase.from('document_submissions').select('id, document_template_id, submitted_at, employee_snapshot').eq('employee_id', eid).eq('status', 'submitted'),
        // is_published=true のみ進捗カウント対象に。非公開分はダッシュボードにも反映しない（migration 141）
        /* audience filter (兼任 + position) のため target_type/facility_ids/position_ids も取得。
           旧コードは tenant 全件 count(*) で、他施設限定アイテム / position 違いアイテムが
           分母に入り達成率が永遠に下がる問題があった。 */
        /* content-version-tracking: 版基準列 (compliance/announcement/manual=updated_at,
           training=recert_at) を取得し、現版で完了しているかを判定する。
           既読は announcement_reads / manual_reads ではなく append-only の
           {category}_view_logs を参照 (編集後の再閲覧が反映されるように)。 */
        supabase.from('compliance_documents').select('id, target_type, target_facility_ids, target_position_ids, updated_at').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('compliance_acknowledgments').select('compliance_document_id, document_updated_at').eq('employee_id', eid),
        supabase.from('trainings').select('id, target_type, target_facility_ids, target_position_ids, recert_at').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('training_submissions').select('training_id, submitted_at').eq('employee_id', eid).eq('result', 'passed'),
        supabase.from('announcements').select('id, target_type, target_facility_ids, target_position_ids, updated_at').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('announcement_view_logs').select('item_id, viewed_at').eq('employee_id', eid),
        supabase.from('manuals').select('id, target_type, target_facility_ids, target_position_ids, updated_at').eq('tenant_id', tid).eq('is_published', true),
        supabase.from('manual_view_logs').select('item_id, viewed_at').eq('employee_id', eid),
        supabase.from('shift_requests').select('id').eq('employee_id', eid).eq('month', nextMonth),
        /* 個別連絡 未読: 自分が参加するスレッドのメッセージで自分以外発信 & 未既読のもの (sidebar と同じロジック) */
        supabase.from('message_thread_members').select('thread_id').eq('employee_id', eid),
        supabase.from('message_reads').select('message_id').eq('employee_id', eid),
        /* シフトカード: 今月+来月の自分の出勤予定 (assignment_type='normal' かつ ready/published)。
           今月が未公開でも来月の公開分を拾えるよう範囲を来月末まで広げる。 */
        supabase
          .from('shift_assignments')
          .select('date')
          .eq('employee_id', eid)
          .in('publish_status', ['ready', 'published'])
          .eq('assignment_type', 'normal')
          .gte('date', thisMonthFrom)
          .lte('date', nextMonthTo),
      ]);

      /* 175: /my/documents と同じ filter + snapshot 判定をここでもやる。
         旧コードは tenant 全テンプ × 単純 updated_at 比較で、配布対象外/会社発行/matrix の
         テンプまで分母に入り、かつ「住所だけ変えた」でも全件再提出フラグが立っていた。 */
      const allTemplates = (templates.data ?? []) as DocumentTemplate[];
      const allTemplateIds = allTemplates.map((t) => t.id);
      const { isEmployeeInAudience, loadTemplateAudience } = await import('@/lib/template-audience');
      const audienceByTemplate = await loadTemplateAudience(supabase, allTemplateIds);
      const filteredTemplates = allTemplates.filter((t) => {
        if (t.template_type === 'pdf' && t.data_mode === 'matrix') return false;
        if (t.is_company_issued) return false;
        return isEmployeeInAudience(t.id, me as unknown as import('@/lib/types').Employee, audienceByTemplate);
      });
      const filteredTemplateIdSet = new Set(filteredTemplates.map((t) => t.id));

      /* PDF テンプの参照 employees カラムを per-template で集計 */
      const { data: pdfTagsRows } = await supabase
        .from('pdf_tags')
        .select('*')
        .in('template_id', filteredTemplates.map((t) => t.id));
      const tagsByTemplate = new Map<string, PdfTag[]>();
      for (const tag of (pdfTagsRows ?? []) as PdfTag[]) {
        const arr = tagsByTemplate.get(tag.template_id) ?? [];
        arr.push(tag);
        tagsByTemplate.set(tag.template_id, arr);
      }
      const refMap = new Map<string, Set<string>>();
      for (const t of filteredTemplates) {
        refMap.set(t.id, extractReferencedEmployeeFields(t, tagsByTemplate.get(t.id) ?? []));
      }

      const filteredSubs = ((submissions.data ?? []) as { id: string; document_template_id: string; submitted_at: string | null; employee_snapshot: Record<string, unknown> | null }[])
        .filter((s) => filteredTemplateIdSet.has(s.document_template_id));

      const tTotal = filteredTemplates.length;
      const tDone = filteredSubs.length;
      const empUpdatedAt = (me.updated_at as string) ?? null;
      const docResubmitCount = filteredSubs.filter((s) => {
        if (!s.submitted_at) return false;
        /* snapshot がある新提出: 参照カラム集合のみで差分判定 (false positive 抑制) */
        if (s.employee_snapshot) {
          return needsResubmitBySnapshot(
            s.employee_snapshot,
            me as unknown as Record<string, unknown>,
            refMap.get(s.document_template_id) ?? new Set<string>(),
          );
        }
        /* snapshot 無い旧提出: 旧来の updated_at vs submitted_at 比較に fallback */
        return empUpdatedAt && new Date(empUpdatedAt) > new Date(s.submitted_at);
      }).length;
      /* audience filter (isItemInAudience): facility 兼任 + position の AND 判定。
         layout tab badge と同じロジックなので、ダッシュボードカードと赤バッジが一致する。 */
      const myFacilityIds = await fetchMyFacilityIds(supabase, me.id, me.facility_id);
      /* シフトカード赤バッジ: 今月+来月の ready/published がある (施設,月) のうち、
         自分の確認記録が無い数。layout の nav バッジと同一ロジック（migration 216）。 */
      const [shiftBadgeAssignRes, shiftBadgeConfRes] = await Promise.all([
        supabase.from('shift_assignments').select('facility_id, date').in('facility_id', myFacilityIds.length ? myFacilityIds : ['00000000-0000-0000-0000-000000000000']).in('publish_status', ['ready', 'published']).gte('date', thisMonthFrom).lte('date', nextMonthTo),
        supabase.from('shift_confirmations').select('facility_id, month').eq('employee_id', eid).in('month', [thisMonthKey, nextMonth]),
      ]);
      const shiftBadgeFacMonths = new Set(((shiftBadgeAssignRes.data ?? []) as { facility_id: string; date: string }[]).map((r) => `${r.facility_id}__${r.date.slice(0, 7)}`));
      const shiftBadgeConfirmed = new Set(((shiftBadgeConfRes.data ?? []) as { facility_id: string; month: string }[]).map((r) => `${r.facility_id}__${r.month}`));
      const shiftUnconfirmed = [...shiftBadgeFacMonths].filter((k) => !shiftBadgeConfirmed.has(k)).length;
      const myPositionId = (me.position_id as string | null) ?? null;
      type Row4 = { id: string; target_type: TargetType; target_facility_ids: string[] | null; target_position_ids: string[] | null };
      const scopedCompList = ((compliance.data ?? []) as Row4[]).filter((r) => isItemInAudience(r, myFacilityIds, myPositionId));
      const scopedTrainList = ((trainings.data ?? []) as Row4[]).filter((r) => isItemInAudience(r, myFacilityIds, myPositionId));
      const scopedAnnList = ((announcements.data ?? []) as Row4[]).filter((r) => isItemInAudience(r, myFacilityIds, myPositionId));
      const scopedManList = ((manuals.data ?? []) as Row4[]).filter((r) => isItemInAudience(r, myFacilityIds, myPositionId));

      /* content-version-tracking: 各カテゴリ「現版で完了済み」の item ID 集合を作る。
         - compliance: ack.document_updated_at が現 updated_at と一致
         - trainings : 合格提出の submitted_at が現 recert_at 以降
         - announcements/manuals: view_log の最新 viewed_at が現 updated_at 以降
         分子 (Done) は scoped list を回して done 集合に含まれる件数 → audience 外で
         誤完了した行は自然に除外され、分子分母が一致する。 */
      const compVer = new Map(((compliance.data ?? []) as { id: string; updated_at: string }[]).map((r) => [r.id, r.updated_at]));
      const compDoneIds = new Set(
        ((compAcks.data ?? []) as { compliance_document_id: string; document_updated_at: string | null }[])
          .filter((a) => a.document_updated_at != null && a.document_updated_at === compVer.get(a.compliance_document_id))
          .map((a) => a.compliance_document_id),
      );
      const trainVer = new Map(((trainings.data ?? []) as { id: string; recert_at: string }[]).map((r) => [r.id, r.recert_at]));
      const trainDoneIds = new Set(
        ((trainSubs.data ?? []) as { training_id: string; submitted_at: string }[])
          .filter((s) => {
            const ver = trainVer.get(s.training_id);
            return ver != null && s.submitted_at >= ver;
          })
          .map((s) => s.training_id),
      );
      /* view_log は append-only。item ごとの最新 viewed_at を取り updated_at と比較。 */
      const viewDoneIds = (
        verData: { id: string; updated_at: string }[],
        viewData: { item_id: string; viewed_at: string }[],
      ): Set<string> => {
        const verMap = new Map(verData.map((r) => [r.id, r.updated_at]));
        const latest = new Map<string, string>();
        for (const v of viewData) {
          const cur = latest.get(v.item_id);
          if (!cur || v.viewed_at > cur) latest.set(v.item_id, v.viewed_at);
        }
        const done = new Set<string>();
        for (const [itemId, lv] of latest) {
          const ver = verMap.get(itemId);
          if (ver != null && lv >= ver) done.add(itemId);
        }
        return done;
      };
      const annDoneIds = viewDoneIds(
        (announcements.data ?? []) as { id: string; updated_at: string }[],
        (annViewLogs.data ?? []) as { item_id: string; viewed_at: string }[],
      );
      const manualDoneIds = viewDoneIds(
        (manuals.data ?? []) as { id: string; updated_at: string }[],
        (manualViewLogs.data ?? []) as { item_id: string; viewed_at: string }[],
      );
      const cTotal = scopedCompList.length;
      const cDone = scopedCompList.filter((r) => compDoneIds.has(r.id)).length;
      const trTotal = scopedTrainList.length;
      const trDone = scopedTrainList.filter((r) => trainDoneIds.has(r.id)).length;
      const aTotal = scopedAnnList.length;
      const aDone = scopedAnnList.filter((r) => annDoneIds.has(r.id)).length;
      const mTotal = scopedManList.length;
      const mDone = scopedManList.filter((r) => manualDoneIds.has(r.id)).length;
      const reqDone = (shiftReqs.data?.length || 0) > 0;

      /* 個別連絡 未読件数 (sidebar layout と同じロジック) */
      const myThreadIds = ((threadMembers.data || []) as { thread_id: string }[]).map((r) => r.thread_id);
      const myReadMsgIds = new Set(((messageReads.data || []) as { message_id: string }[]).map((r) => r.message_id));
      let messageUnreadCount = 0;
      if (myThreadIds.length > 0) {
        const { data: pendingMsgs } = await supabase
          .from('messages')
          .select('id, sender_employee_id')
          .in('thread_id', myThreadIds)
          .neq('sender_employee_id', eid)
          .is('deleted_at', null);
        messageUnreadCount = ((pendingMsgs || []) as { id: string }[]).filter((m) => !myReadMsgIds.has(m.id)).length;
      }

      /* シフトカード: 今月に公開/ready の出勤予定が無ければ来月を見る（翌月公開・今月未公開対策）。
         href も対象月へ深リンクし、職員が公開済みシフトに直接着地できるようにする。 */
      const shiftPlannedRows = (shiftPlanned.data ?? []) as { date: string }[];
      const thisMonthPlanned = shiftPlannedRows.filter((r) => r.date.slice(0, 7) === thisMonthKey).length;
      const nextMonthPlanned = shiftPlannedRows.filter((r) => r.date.slice(0, 7) === nextMonth).length;
      const shiftCardMonth = thisMonthPlanned > 0 ? thisMonthKey : (nextMonthPlanned > 0 ? nextMonth : thisMonthKey);
      const shiftPlannedCount = thisMonthPlanned > 0 ? thisMonthPlanned : nextMonthPlanned;
      const shiftCardMonthNum = Number(shiftCardMonth.slice(5, 7));

      // 「最近の更新」ヒーローデータ: 7日以内かつ未消化の遵守事項/研修/お知らせ
      const sinceIso = new Date(Date.now() - HERO_DAYS * 24 * 60 * 60 * 1000).toISOString();
      type ScopedRow = { id: string; title?: string | null; created_at: string; target_type: TargetType; target_facility_ids: string[] };

      const [recentAnn, recentComp, recentTrain, recentManual] = await Promise.all([
        supabase.from('announcements')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .eq('is_published', true)
          .gte('created_at', sinceIso),
        supabase.from('compliance_documents')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .eq('is_published', true)
          .gte('created_at', sinceIso),
        supabase.from('trainings')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .eq('is_published', true)
          .gte('created_at', sinceIso),
        supabase.from('manuals')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .eq('is_published', true)
          .gte('created_at', sinceIso),
      ]);

      /* 「最近の更新」フィードの未対応判定も content-version-tracking の現版完了集合
         (compDoneIds / trainDoneIds / annDoneIds / manualDoneIds) を流用する。
         → 編集後に「現版未完了」へ戻ったアイテムもフィードに再掲される。 */

      const scopedAnn = applyScopeFilter((recentAnn.data || []) as ScopedRow[], me.facility_id);
      const scopedComp = applyScopeFilter((recentComp.data || []) as ScopedRow[], me.facility_id);
      const scopedTrain = applyScopeFilter((recentTrain.data || []) as ScopedRow[], me.facility_id);
      const scopedManual = applyScopeFilter((recentManual.data || []) as ScopedRow[], me.facility_id);

      const allUpdates: UpdateItem[] = [
        ...scopedAnn.filter(a => !annDoneIds.has(a.id)).map(a => ({
          kind: 'announcement' as const, id: a.id, title: a.title || '（無題）',
          createdAt: a.created_at, href: '/my/announcements', icon: '📢', label: 'お知らせ',
        })),
        ...scopedComp.filter(c => !compDoneIds.has(c.id)).map(c => ({
          kind: 'compliance' as const, id: c.id, title: c.title || '（無題）',
          createdAt: c.created_at, href: '/my/compliance', icon: '✅', label: '遵守事項',
        })),
        ...scopedTrain.filter(t => !trainDoneIds.has(t.id)).map(t => ({
          kind: 'training' as const, id: t.id, title: t.title || '（無題）',
          createdAt: t.created_at, href: '/my/trainings', icon: '📚', label: '研修',
        })),
        ...scopedManual.filter(m => !manualDoneIds.has(m.id)).map(m => ({
          kind: 'manual' as const, id: m.id, title: m.title || '（無題）',
          createdAt: m.created_at, href: '/my/manuals', icon: '📘', label: '業務マニュアル',
        })),
      ];
      allUpdates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setUpdates(allUpdates);

      setTodos([
        { label: '基本情報', href: '/my/profile', done: basicFilled >= basicFields.length, current: basicFilled, total: basicFields.length, icon: '👤' },
        { label: '自己紹介', href: '/my/about', done: aboutFilled >= aboutFields.length, current: aboutFilled, total: aboutFields.length, icon: '📝' },
        { label: '書類提出', href: '/my/documents', done: tDone >= tTotal && tTotal > 0 && docResubmitCount === 0, current: tDone, total: tTotal, icon: '📄', resubmitCount: docResubmitCount },
        { label: '遵守事項の確認', href: '/my/compliance', done: cDone >= cTotal && cTotal > 0, current: cDone, total: cTotal, icon: '✅' },
        { label: '研修の受講', href: '/my/trainings', done: trDone >= trTotal && trTotal > 0, current: trDone, total: trTotal, icon: '📚' },
        { label: 'お知らせの確認', href: '/my/announcements', done: aDone >= aTotal && aTotal > 0, current: aDone, total: aTotal, icon: '🔔' },
        { label: '業務マニュアル', href: '/my/manuals', done: mDone >= mTotal && mTotal > 0, current: mDone, total: mTotal, icon: '📘' },
        /* sidebar 並びに合わせて 業務マニュアル と 休み希望 の間に「個別連絡」、その後に「シフト」を配置 */
        { label: '個別連絡', href: '/my/messages', done: messageUnreadCount === 0, current: 0, total: 0, icon: '💬', messageUnread: messageUnreadCount },
        { label: 'シフト', href: `/my/requests?tab=facility-shift&month=${shiftCardMonth}`, done: false, current: 0, total: 0, icon: '📅', shiftPlannedDays: shiftPlannedCount, shiftMonthNum: shiftCardMonthNum, shiftUnconfirmed },
        { label: `休み希望（${nextMonthDate.getMonth() + 1}月分）`, href: '/my/requests', done: reqDone, current: reqDone ? 1 : 0, total: 1, icon: '🗓️' },
      ]);

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-brand-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-brand-gray">読み込み中...</span></div>;

  /* 進捗バーの分母から情報カード (total=0 の シフト / 個別連絡) は除外する */
  const progressTodos = todos.filter((t) => t.total > 0);
  const completed = progressTodos.filter((t) => t.done).length;
  const pct = progressTodos.length > 0 ? Math.round((completed / progressTodos.length) * 100) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">こんにちは、{name}さん</h1>

      {updates.length > 0 && (
        <div className="mb-5 mt-3 rounded-md border border-brand-blue/20 bg-brand-blue/[0.03] px-3 py-2">
          <button
            type="button"
            onClick={() => setUpdatesExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 mb-1.5 hover:opacity-80 transition-opacity"
            aria-expanded={updatesExpanded}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-blue opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-blue"></span>
            </span>
            <span className="text-[11px] font-semibold text-brand-ink">最近の更新</span>
            <span className="text-[10px] text-brand-gray-light">{updates.length}件</span>
            <span className={`ml-auto text-[10px] text-brand-gray-light transition-transform ${updatesExpanded ? 'rotate-180' : ''}`}>▼</span>
          </button>
          <ul className="space-y-0.5">
            {(updatesExpanded ? updates : updates.slice(0, UPDATES_PREVIEW)).map((u) => (
              <li key={`${u.kind}-${u.id}`}>
                <Link href={u.href} className="flex items-center gap-2 py-1 text-xs hover:text-brand-blue transition-colors">
                  <span className="text-sm shrink-0">{u.icon}</span>
                  <span className="shrink-0 text-[10px] font-semibold text-brand-blue">{u.label}</span>
                  <span className="truncate text-brand-ink">{u.title}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-brand-gray-light">{daysAgoLabel(u.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {updates.length > UPDATES_PREVIEW && (
            <button
              type="button"
              onClick={() => setUpdatesExpanded((v) => !v)}
              className="w-full mt-1.5 py-1 text-[10px] font-semibold text-brand-blue hover:bg-brand-blue/[0.05] rounded transition-colors"
            >
              {updatesExpanded ? `▲ 折りたたむ` : `▼ 残り ${updates.length - UPDATES_PREVIEW}件を表示`}
            </button>
          )}
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-brand-gray">全体の進捗 — {completed}/{progressTodos.length} 完了</p>
          <p className={`text-sm font-semibold ${
            pct < 30 ? 'text-brand-red'
              : pct < 70 ? 'text-brand-gold'
              : pct < 100 ? 'text-brand-blue'
              : 'text-brand-green'
          }`}>{pct}%</p>
        </div>
        <div className="h-3 w-full rounded-full bg-brand-beige overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              pct < 30 ? 'bg-brand-red'
                : pct < 70 ? 'bg-brand-gold'
                : pct < 100 ? 'bg-brand-blue'
                : 'bg-brand-green'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {todos.map((t) => {
          const itemPct = t.total > 0 ? Math.round((t.current / t.total) * 100) : 0;
          // 未消化がある(=total>0 かつ current<total)かつ通知対象(遵守/研修/お知らせ)ならハイライト
          const unreadCount = t.total - t.current;
          const isNotifKind = t.href === '/my/compliance' || t.href === '/my/trainings' || t.href === '/my/announcements' || t.href === '/my/manuals' || t.href === '/my/requests';
          /* 書類カードは「要再提出」件数だけ赤バッジで表示する (未提出件数では表示しない)。
             /my/documents 側で submitted_at < employees.updated_at の判定と一致。 */
          const resubmitCount = t.resubmitCount ?? 0;
          const isResubmit = t.href === '/my/documents' && resubmitCount > 0;
          /* 個別連絡カード: 未読件数で赤バッジ */
          const isMessageCard = t.href === '/my/messages';
          const messageUnread = t.messageUnread ?? 0;
          const isShiftCard = t.href.startsWith('/my/requests?tab=facility-shift');
          const shiftUnconfirmed = t.shiftUnconfirmed ?? 0;
          const hasUnread =
            (isNotifKind && unreadCount > 0) ||
            isResubmit ||
            (isMessageCard && messageUnread > 0) ||
            (isShiftCard && shiftUnconfirmed > 0);
          const badgeCount = isResubmit
            ? resubmitCount
            : isMessageCard
              ? messageUnread
              : isShiftCard
                ? shiftUnconfirmed
                : unreadCount;
          /* 進捗バー・current/total 表示は total=0 のカード (シフト・個別連絡) では出さない */
          const showProgress = t.total > 0;
          /* シフトカードと個別連絡カードは「完了/未完了」概念がないので line-through も完了バッジも出さない */
          const showDoneStyling = t.total > 0;

          return (
            <Link key={t.href} href={t.href}>
              <Card className={`relative transition-all hover:border-brand-blue h-full ${showDoneStyling && t.done ? 'opacity-60' : ''} ${hasUnread ? 'border-brand-red/50 bg-brand-red/[0.02]' : ''}`}>
                {hasUnread && (
                  <span className="absolute top-1.5 right-1.5 z-10 flex h-5 min-w-[20px] px-1 items-center justify-center rounded-full bg-brand-red text-white text-[10px] font-bold leading-none shadow-sm">
                    <span className="relative">{badgeCount > 99 ? '99+' : badgeCount}</span>
                  </span>
                )}
                <CardContent className="py-4 px-3 sm:px-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xl">{t.icon}</span>
                    {showProgress && (
                      <span className="text-[10px] font-medium text-brand-gray">{t.current}/{t.total}</span>
                    )}
                    {isShiftCard && (
                      <span className="text-[10px] font-medium text-brand-gray">
                        {(t.shiftPlannedDays ?? 0) > 0 ? `${t.shiftPlannedDays}日` : '未公開'}
                      </span>
                    )}
                  </div>
                  <div className="mb-2">
                    <span className={`text-xs sm:text-sm font-medium ${showDoneStyling && t.done ? 'line-through text-brand-gray-light' : ''}`}>
                      {t.label}
                    </span>
                    {showDoneStyling && t.done && <Badge variant="success" className="text-[10px] ml-1">完了</Badge>}
                    {isMessageCard && messageUnread === 0 && (
                      <span className="ml-1 text-[10px] text-brand-gray-light">未読なし</span>
                    )}
                    {isShiftCard && (t.shiftPlannedDays ?? 0) > 0 && (
                      <span className="ml-1 text-[10px] text-brand-gray-light">{t.shiftMonthNum ?? ''}月の予定</span>
                    )}
                  </div>
                  {showProgress && (
                    <div className="h-1.5 w-full rounded-full bg-brand-beige overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${t.done ? 'bg-brand-green' : itemPct > 0 ? 'bg-brand-blue' : 'bg-brand-gray-light/30'}`}
                        style={{ width: `${itemPct}%` }}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
