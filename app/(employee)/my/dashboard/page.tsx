'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { applyScopeFilter } from '@/components/admin/FacilityScopeSelector';
import type { TargetType } from '@/lib/types';

interface TodoItem {
  label: string;
  href: string;
  done: boolean;
  current: number;
  total: number;
  icon: string;
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

      // 基本情報（基本 + 通勤 + 連絡先）
      const basicFields: unknown[] = [
        me.last_name, me.first_name, me.last_name_kana, me.first_name_kana,
        me.birth_date, me.postal_code, me.address, me.phone,
        me.position, me.join_date, me.gender, me.job_type,
      ];
      const basicFilled = basicFields.filter(isFilled).length;

      // 自己紹介（紹介 + 働き方 + コミュ + 強み + 価値観 + チーム）
      const aboutFields: unknown[] = [
        me.self_introduction, me.current_duties, me.past_duties,
        me.efforts_focused_on, me.how_others_describe, me.values_and_motivation,
        me.work_style_solo_vs_team, me.work_style_clear_vs_autonomy,
        me.work_style_stable_vs_change, me.work_style_think_vs_act,
        me.multitask_ability, me.detail_orientation,
        me.comm_conclusion_vs_context, me.comm_consult_timing,
        me.comm_feedback_preference, me.comm_channel_preference,
        me.meeting_behavior, me.relationship_notes,
        me.strength_1, me.strength_2, me.strength_3,
        me.weakness_1, me.weakness_2, me.weakness_3,
        me.success_experience, me.struggle_experience,
        me.workplace_values, me.ideal_boss_colleague, me.disliked_atmosphere,
        me.growth_goal, me.preferred_evaluation, me.safe_environment,
        me.team_role_preference, me.easy_to_work_with,
        me.hard_to_work_with, me.team_mindset,
      ];
      const aboutFilled = aboutFields.filter(isFilled).length;

      // 来月の YYYY-MM
      const now = new Date();
      const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;

      const [templates, submissions, compliance, compAcks, trainings, trainSubs, announcements, annReads, manuals, manualReads, shiftReqs] = await Promise.all([
        supabase.from('document_templates').select('id').eq('tenant_id', tid),
        supabase.from('document_submissions').select('id').eq('employee_id', eid).eq('status', 'submitted'),
        supabase.from('compliance_documents').select('id').eq('tenant_id', tid),
        supabase.from('compliance_acknowledgments').select('compliance_document_id').eq('employee_id', eid),
        supabase.from('trainings').select('id').eq('tenant_id', tid),
        supabase.from('training_submissions').select('training_id').eq('employee_id', eid).eq('result', 'passed'),
        supabase.from('announcements').select('id').eq('tenant_id', tid),
        supabase.from('announcement_reads').select('announcement_id').eq('employee_id', eid),
        supabase.from('manuals').select('id').eq('tenant_id', tid),
        supabase.from('manual_reads').select('manual_id').eq('employee_id', eid),
        supabase.from('shift_requests').select('id').eq('employee_id', eid).eq('month', nextMonth),
      ]);

      const tTotal = templates.data?.length || 0;
      const tDone = submissions.data?.length || 0;
      const cTotal = compliance.data?.length || 0;
      const cDone = compAcks.data?.length || 0;
      const trTotal = trainings.data?.length || 0;
      const trDone = trainSubs.data?.length || 0;
      const aTotal = announcements.data?.length || 0;
      const aDone = annReads.data?.length || 0;
      const mTotal = manuals.data?.length || 0;
      const mDone = manualReads.data?.length || 0;
      const reqDone = (shiftReqs.data?.length || 0) > 0;

      // 「最近の更新」ヒーローデータ: 7日以内かつ未消化の遵守事項/研修/お知らせ
      const sinceIso = new Date(Date.now() - HERO_DAYS * 24 * 60 * 60 * 1000).toISOString();
      type ScopedRow = { id: string; title?: string | null; created_at: string; target_type: TargetType; target_facility_ids: string[] };

      const [recentAnn, recentComp, recentTrain, recentManual] = await Promise.all([
        supabase.from('announcements')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .gte('created_at', sinceIso),
        supabase.from('compliance_documents')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .gte('created_at', sinceIso),
        supabase.from('trainings')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .gte('created_at', sinceIso),
        supabase.from('manuals')
          .select('id, title, created_at, target_type, target_facility_ids')
          .eq('tenant_id', tid)
          .gte('created_at', sinceIso),
      ]);

      const readAnnSet = new Set((annReads.data || []).map((r: { announcement_id: string }) => r.announcement_id));
      const confirmedCompIds = new Set((compAcks.data || []).map((a: { compliance_document_id: string }) => a.compliance_document_id));
      const passedTrainIds = new Set((trainSubs.data || []).map((s: { training_id: string }) => s.training_id));
      const readManualSet = new Set((manualReads.data || []).map((r: { manual_id: string }) => r.manual_id));

      const scopedAnn = applyScopeFilter((recentAnn.data || []) as ScopedRow[], me.facility_id);
      const scopedComp = applyScopeFilter((recentComp.data || []) as ScopedRow[], me.facility_id);
      const scopedTrain = applyScopeFilter((recentTrain.data || []) as ScopedRow[], me.facility_id);
      const scopedManual = applyScopeFilter((recentManual.data || []) as ScopedRow[], me.facility_id);

      const allUpdates: UpdateItem[] = [
        ...scopedAnn.filter(a => !readAnnSet.has(a.id)).map(a => ({
          kind: 'announcement' as const, id: a.id, title: a.title || '（無題）',
          createdAt: a.created_at, href: '/my/announcements', icon: '📢', label: 'お知らせ',
        })),
        ...scopedComp.filter(c => !confirmedCompIds.has(c.id)).map(c => ({
          kind: 'compliance' as const, id: c.id, title: c.title || '（無題）',
          createdAt: c.created_at, href: '/my/compliance', icon: '✅', label: '遵守事項',
        })),
        ...scopedTrain.filter(t => !passedTrainIds.has(t.id)).map(t => ({
          kind: 'training' as const, id: t.id, title: t.title || '（無題）',
          createdAt: t.created_at, href: '/my/trainings', icon: '📚', label: '研修',
        })),
        ...scopedManual.filter(m => !readManualSet.has(m.id)).map(m => ({
          kind: 'manual' as const, id: m.id, title: m.title || '（無題）',
          createdAt: m.created_at, href: '/my/manuals', icon: '📘', label: '業務マニュアル',
        })),
      ];
      allUpdates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setUpdates(allUpdates);

      setTodos([
        { label: '基本情報', href: '/my/profile', done: basicFilled >= basicFields.length, current: basicFilled, total: basicFields.length, icon: '👤' },
        { label: '自己紹介', href: '/my/about', done: aboutFilled >= aboutFields.length, current: aboutFilled, total: aboutFields.length, icon: '📝' },
        { label: '書類提出', href: '/my/documents', done: tDone >= tTotal && tTotal > 0, current: tDone, total: tTotal, icon: '📄' },
        { label: '遵守事項の確認', href: '/my/compliance', done: cDone >= cTotal && cTotal > 0, current: cDone, total: cTotal, icon: '✅' },
        { label: '研修の受講', href: '/my/trainings', done: trDone >= trTotal && trTotal > 0, current: trDone, total: trTotal, icon: '📚' },
        { label: 'お知らせの確認', href: '/my/announcements', done: aDone >= aTotal && aTotal > 0, current: aDone, total: aTotal, icon: '🔔' },
        { label: '業務マニュアル', href: '/my/manuals', done: mDone >= mTotal && mTotal > 0, current: mDone, total: mTotal, icon: '📘' },
        { label: `休み希望（${nextMonthDate.getMonth() + 1}月分）`, href: '/my/requests', done: reqDone, current: reqDone ? 1 : 0, total: 1, icon: '🗓️' },
      ]);

      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;

  const completed = todos.filter((t) => t.done).length;

  const pct = todos.length > 0 ? Math.round((completed / todos.length) * 100) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">こんにちは、{name}さん</h1>

      {updates.length > 0 && (
        <div className="mb-5 mt-3 rounded-md border border-diletto-blue/20 bg-diletto-blue/[0.03] px-3 py-2">
          <button
            type="button"
            onClick={() => setUpdatesExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 mb-1.5 hover:opacity-80 transition-opacity"
            aria-expanded={updatesExpanded}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-diletto-blue opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-diletto-blue"></span>
            </span>
            <span className="text-[11px] font-semibold text-diletto-ink">最近の更新</span>
            <span className="text-[10px] text-diletto-gray-light">{updates.length}件</span>
            <span className={`ml-auto text-[10px] text-diletto-gray-light transition-transform ${updatesExpanded ? 'rotate-180' : ''}`}>▼</span>
          </button>
          <ul className="space-y-0.5">
            {(updatesExpanded ? updates : updates.slice(0, UPDATES_PREVIEW)).map((u) => (
              <li key={`${u.kind}-${u.id}`}>
                <Link href={u.href} className="flex items-center gap-2 py-1 text-xs hover:text-diletto-blue transition-colors">
                  <span className="text-sm shrink-0">{u.icon}</span>
                  <span className="shrink-0 text-[10px] font-semibold text-diletto-blue">{u.label}</span>
                  <span className="truncate text-diletto-ink">{u.title}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-diletto-gray-light">{daysAgoLabel(u.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {updates.length > UPDATES_PREVIEW && (
            <button
              type="button"
              onClick={() => setUpdatesExpanded((v) => !v)}
              className="w-full mt-1.5 py-1 text-[10px] font-semibold text-diletto-blue hover:bg-diletto-blue/[0.05] rounded transition-colors"
            >
              {updatesExpanded ? `▲ 折りたたむ` : `▼ 残り ${updates.length - UPDATES_PREVIEW}件を表示`}
            </button>
          )}
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-diletto-gray">全体の進捗 — {completed}/{todos.length} 完了</p>
          <p className={`text-sm font-semibold ${
            pct < 30 ? 'text-diletto-red'
              : pct < 70 ? 'text-diletto-gold'
              : pct < 100 ? 'text-diletto-blue'
              : 'text-diletto-green'
          }`}>{pct}%</p>
        </div>
        <div className="h-3 w-full rounded-full bg-diletto-beige overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              pct < 30 ? 'bg-diletto-red'
                : pct < 70 ? 'bg-diletto-gold'
                : pct < 100 ? 'bg-diletto-blue'
                : 'bg-diletto-green'
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
          const hasUnread = isNotifKind && unreadCount > 0;

          return (
            <Link key={t.href} href={t.href}>
              <Card className={`relative transition-all hover:border-diletto-blue h-full ${t.done ? 'opacity-60' : ''} ${hasUnread ? 'border-diletto-red/50 bg-diletto-red/[0.02]' : ''}`}>
                {hasUnread && (
                  <span className="absolute top-1.5 right-1.5 z-10 flex h-5 min-w-[20px] px-1 items-center justify-center rounded-full bg-diletto-red text-white text-[10px] font-bold leading-none shadow-sm">
                    <span className="relative">{unreadCount > 99 ? '99+' : unreadCount}</span>
                  </span>
                )}
                <CardContent className="py-4 px-3 sm:px-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xl">{t.icon}</span>
                    <span className="text-[10px] font-medium text-diletto-gray">{t.current}/{t.total}</span>
                  </div>
                  <div className="mb-2">
                    <span className={`text-xs sm:text-sm font-medium ${t.done ? 'line-through text-diletto-gray-light' : ''}`}>
                      {t.label}
                    </span>
                    {t.done && <Badge variant="success" className="text-[10px] ml-1">完了</Badge>}
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-diletto-beige overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${t.done ? 'bg-diletto-green' : itemPct > 0 ? 'bg-diletto-blue' : 'bg-diletto-gray-light/30'}`}
                      style={{ width: `${itemPct}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
