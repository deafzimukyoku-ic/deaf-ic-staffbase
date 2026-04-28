'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileSection2Intro } from '@/components/employee/ProfileSection2Intro';
import { ProfileSection3WorkStyle } from '@/components/employee/ProfileSection3WorkStyle';
import { ProfileSection4Comm } from '@/components/employee/ProfileSection4Comm';
import { ProfileSection5Strengths } from '@/components/employee/ProfileSection5Strengths';
import { ProfileSection6Values } from '@/components/employee/ProfileSection6Values';
import { ProfileSection7Team } from '@/components/employee/ProfileSection7Team';
import { toast } from 'sonner';
import type { Employee } from '@/lib/types';

const TABS = [
  { value: 'intro', label: '紹介', icon: '📝' },
  { value: 'workstyle', label: '働き方', icon: '💼' },
  { value: 'comm', label: 'コミュ', icon: '💬' },
  { value: 'strengths', label: '強み', icon: '💪' },
  { value: 'values', label: '価値観', icon: '🌟' },
  { value: 'team', label: 'チーム', icon: '🤝' },
] as const;

export default function AboutPage() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('intro');
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

      if (data) setEmployee(data as Employee);
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

    toast.success('自己紹介を保存しました');
    setSaving(false);
  }

  if (loading) return <div className="flex items-center justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-diletto-blue border-t-transparent rounded-full" /><span className="ml-3 text-sm text-diletto-gray">読み込み中...</span></div>;
  if (!employee) return <p className="text-diletto-red">プロフィールが見つかりません</p>;

  function updateSection<T>(sectionData: T) {
    setEmployee((prev) => prev ? { ...prev, ...sectionData } : null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-xl sm:text-2xl font-bold">自己紹介</h1>
        <Button onClick={handleSave} disabled={saving} className="shrink-0">
          {saving ? '保存中...' : '保存する'}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex w-full overflow-x-auto no-scrollbar">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 flex-1 text-xs sm:text-sm px-2 sm:px-3">
              <span className="mr-1">{tab.icon}</span>{tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="intro">
          <ProfileSection2Intro
            data={{
              self_introduction: employee.self_introduction, current_duties: employee.current_duties,
              past_duties: employee.past_duties,
              efforts_focused_on: employee.efforts_focused_on, how_others_describe: employee.how_others_describe,
              values_and_motivation: employee.values_and_motivation,
            }}
            onChange={updateSection}
          />
        </TabsContent>

        <TabsContent value="workstyle">
          <ProfileSection3WorkStyle
            data={{
              work_style_solo_vs_team: employee.work_style_solo_vs_team,
              work_style_clear_vs_autonomy: employee.work_style_clear_vs_autonomy,
              work_style_stable_vs_change: employee.work_style_stable_vs_change,
              work_style_think_vs_act: employee.work_style_think_vs_act,
              multitask_ability: employee.multitask_ability, detail_orientation: employee.detail_orientation,
            }}
            onChange={updateSection}
          />
        </TabsContent>

        <TabsContent value="comm">
          <ProfileSection4Comm
            data={{
              comm_conclusion_vs_context: employee.comm_conclusion_vs_context,
              comm_consult_timing: employee.comm_consult_timing,
              comm_feedback_preference: employee.comm_feedback_preference,
              comm_channel_preference: employee.comm_channel_preference,
              meeting_behavior: employee.meeting_behavior, relationship_notes: employee.relationship_notes,
            }}
            onChange={updateSection}
          />
        </TabsContent>

        <TabsContent value="strengths">
          <ProfileSection5Strengths
            data={{
              strength_1: employee.strength_1, strength_2: employee.strength_2, strength_3: employee.strength_3,
              weakness_1: employee.weakness_1, weakness_2: employee.weakness_2, weakness_3: employee.weakness_3,
              success_experience: employee.success_experience, success_reason: employee.success_reason,
              struggle_experience: employee.struggle_experience, struggle_reason: employee.struggle_reason,
              suited_tasks: employee.suited_tasks, burden_tasks: employee.burden_tasks,
            }}
            onChange={updateSection}
          />
        </TabsContent>

        <TabsContent value="values">
          <ProfileSection6Values
            data={{
              workplace_values: employee.workplace_values, ideal_boss_colleague: employee.ideal_boss_colleague,
              disliked_atmosphere: employee.disliked_atmosphere, growth_goal: employee.growth_goal,
              preferred_evaluation: employee.preferred_evaluation, safe_environment: employee.safe_environment,
              strengths_self_reported: employee.strengths_self_reported, work_style_preference: employee.work_style_preference,
            }}
            onChange={updateSection}
          />
        </TabsContent>

        <TabsContent value="team">
          <ProfileSection7Team
            data={{
              team_role_preference: employee.team_role_preference, easy_to_work_with: employee.easy_to_work_with,
              hard_to_work_with: employee.hard_to_work_with, team_mindset: employee.team_mindset,
            }}
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
          <div className="mt-8 flex items-center justify-between border-t border-diletto-gray/10 pt-6">
            {prev ? (
              <button
                onClick={() => { setActiveTab(prev.value); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="group flex items-center gap-2 text-sm text-diletto-gray hover:text-diletto-ink transition-colors"
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
                  className={`rounded-full transition-all duration-300 ${i === idx ? 'w-6 h-2 bg-diletto-blue' : 'w-2 h-2 bg-diletto-gray/20 hover:bg-diletto-gray/40'}`}
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
                className="group flex items-center gap-2 text-sm font-medium text-diletto-blue hover:text-diletto-ink transition-colors"
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
