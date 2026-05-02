'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { Employee } from '@/lib/types';
import { MANAGER_VISIBLE_FIELDS } from '@/lib/manager-visible-fields';

type VisibleEmployee = Pick<Employee, (typeof MANAGER_VISIBLE_FIELDS)[number]>;

interface Props {
  employee: VisibleEmployee;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-diletto-gray-light">{label}</span>
      <span className="text-[#111] text-right max-w-[60%]">{value}</span>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-diletto-gray-light mb-1">{label}</p>
      <p className="text-sm text-[#111] whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export function SubordinateDetail({ employee: e }: Props) {
  return (
    <div className="space-y-6">
      {/* 基本所属情報 */}
      <Card>
        <CardHeader><CardTitle className="text-base">所属情報</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <InfoRow label="社員番号" value={e.employee_number} />
          <InfoRow label="氏名" value={`${e.last_name} ${e.first_name}`} />
          <InfoRow label="フリガナ" value={`${e.last_name_kana} ${e.first_name_kana}`} />
          <InfoRow label="役職" value={e.position || '-'} />
          <InfoRow label="職種" value={e.job_type || '-'} />
          <InfoRow label="勤務地" value={e.work_location || '-'} />
          <InfoRow label="入社日" value={e.join_date ?? '-'} />
          <InfoRow label="勤続年数" value={e.years_of_service != null ? `${e.years_of_service}年` : '-'} />
        </CardContent>
      </Card>

      {/* 通勤・送迎 */}
      <Card>
        <CardHeader><CardTitle className="text-base">通勤・送迎</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <InfoRow label="自家用車通勤" value={e.has_car_commute ? 'あり' : 'なし'} />
          <InfoRow label="送迎ドライバー" value={e.is_shuttle_driver ? 'あり' : 'なし'} />
          {(e.has_car_commute || e.is_shuttle_driver) && (
            <>
              <Separator className="my-2" />
              <InfoRow label="運転経験" value={e.driving_experience || '-'} />
              <InfoRow label="事故歴" value={e.accident_history || '-'} />
              <InfoRow label="研修受講歴" value={e.training_attendance || '-'} />
            </>
          )}
        </CardContent>
      </Card>

      {/* 自己紹介・業務経歴 */}
      {(e.self_introduction || e.current_duties || e.past_duties || e.qualifications) && (
        <Card>
          <CardHeader><CardTitle className="text-base">自己紹介・業務経歴</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TextBlock label="自己紹介" value={e.self_introduction} />
            <TextBlock label="現在の業務" value={e.current_duties} />
            <TextBlock label="過去の業務" value={e.past_duties} />
            <TextBlock label="資格" value={Array.isArray(e.qualifications) && e.qualifications.length > 0 ? e.qualifications.join('、') : null} />
            <TextBlock label="力を入れていること" value={e.efforts_focused_on} />
            <TextBlock label="周囲からの評価" value={e.how_others_describe} />
            <TextBlock label="価値観・モチベーション" value={e.values_and_motivation} />
          </CardContent>
        </Card>
      )}

      {/* 働き方の好み */}
      {(e.work_style_solo_vs_team || e.work_style_clear_vs_autonomy || e.work_style_stable_vs_change || e.work_style_think_vs_act) && (
        <Card>
          <CardHeader><CardTitle className="text-base">働き方の好み</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <InfoRow label="個人 vs チーム" value={e.work_style_solo_vs_team || '-'} />
            <InfoRow label="指示明確 vs 裁量" value={e.work_style_clear_vs_autonomy || '-'} />
            <InfoRow label="安定 vs 変化" value={e.work_style_stable_vs_change || '-'} />
            <InfoRow label="熟考 vs 行動" value={e.work_style_think_vs_act || '-'} />
            <InfoRow label="マルチタスク" value={e.multitask_ability || '-'} />
            <InfoRow label="細部へのこだわり" value={e.detail_orientation || '-'} />
          </CardContent>
        </Card>
      )}

      {/* コミュニケーション傾向 */}
      {(e.comm_conclusion_vs_context || e.comm_consult_timing || e.comm_feedback_preference) && (
        <Card>
          <CardHeader><CardTitle className="text-base">コミュニケーション傾向</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <InfoRow label="結論先 vs 背景先" value={e.comm_conclusion_vs_context || '-'} />
            <InfoRow label="相談タイミング" value={e.comm_consult_timing || '-'} />
            <InfoRow label="フィードバック" value={e.comm_feedback_preference || '-'} />
            <InfoRow label="チャネル" value={e.comm_channel_preference || '-'} />
            <InfoRow label="会議での傾向" value={e.meeting_behavior || '-'} />
            <TextBlock label="人間関係メモ" value={e.relationship_notes} />
          </CardContent>
        </Card>
      )}

      {/* 強み・弱み */}
      {(e.strength_1 || e.weakness_1 || e.success_experience) && (
        <Card>
          <CardHeader><CardTitle className="text-base">強み・弱み</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-diletto-gray-light mb-2">強み</p>
                <ul className="space-y-1 text-sm">
                  {e.strength_1 && <li>・{e.strength_1}</li>}
                  {e.strength_2 && <li>・{e.strength_2}</li>}
                  {e.strength_3 && <li>・{e.strength_3}</li>}
                </ul>
              </div>
              <div>
                <p className="text-xs text-diletto-gray-light mb-2">弱み</p>
                <ul className="space-y-1 text-sm">
                  {e.weakness_1 && <li>・{e.weakness_1}</li>}
                  {e.weakness_2 && <li>・{e.weakness_2}</li>}
                  {e.weakness_3 && <li>・{e.weakness_3}</li>}
                </ul>
              </div>
            </div>
            <Separator />
            <TextBlock label="成功体験" value={e.success_experience} />
            <TextBlock label="成功の理由" value={e.success_reason} />
            <TextBlock label="苦労した経験" value={e.struggle_experience} />
            <TextBlock label="苦労の理由" value={e.struggle_reason} />
            <TextBlock label="得意な業務" value={e.suited_tasks} />
            <TextBlock label="負担に感じる業務" value={e.burden_tasks} />
          </CardContent>
        </Card>
      )}

      {/* 価値観・カルチャー */}
      {(e.workplace_values || e.ideal_boss_colleague || e.growth_goal) && (
        <Card>
          <CardHeader><CardTitle className="text-base">価値観・カルチャー</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TextBlock label="職場の価値観" value={e.workplace_values} />
            <TextBlock label="理想の上司・同僚" value={e.ideal_boss_colleague} />
            <TextBlock label="苦手な雰囲気" value={e.disliked_atmosphere} />
            <TextBlock label="成長目標" value={e.growth_goal} />
            <TextBlock label="望む評価方法" value={e.preferred_evaluation} />
            <TextBlock label="安心できる環境" value={e.safe_environment} />
            <TextBlock label="自己申告の強み" value={e.strengths_self_reported} />
            <TextBlock label="働き方の好み" value={e.work_style_preference} />
          </CardContent>
        </Card>
      )}

      {/* チーム相性 */}
      {(e.team_role_preference || e.easy_to_work_with || e.team_mindset) && (
        <Card>
          <CardHeader><CardTitle className="text-base">チーム相性</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TextBlock label="チームでの役割の好み" value={e.team_role_preference} />
            <TextBlock label="一緒に働きやすいタイプ" value={e.easy_to_work_with} />
            <TextBlock label="苦手なタイプ" value={e.hard_to_work_with} />
            <TextBlock label="チームへの考え方" value={e.team_mindset} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
