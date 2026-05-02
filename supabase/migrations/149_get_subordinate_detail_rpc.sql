-- 149: 部下プロフィール詳細取得 RPC
--
-- 背景:
-- /mgr/subordinates 一覧は migration 146/147/148 の SECURITY DEFINER RPC
-- get_my_subordinates() で取得しているが、詳細ページ
-- app/(manager)/mgr/subordinates/[id]/page.tsx は直接 employees テーブルを
-- SELECT していたため、employees の RLS が manager に SELECT を許可していない結果、
-- manager ロールでは「この社員の情報を閲覧する権限がありません」となっていた。
--
-- 仕様:
-- - admin / super_admin : 自テナント内の任意社員（自分以外）
-- - manager / shift_manager : 管轄施設（primary + employee_facilities + manager_facilities）に
--   主所属または兼務する社員（自分以外）
-- - employee : 何も返さない
-- - 認可外なら NULL を返す
--
-- セキュリティ:
-- - RLS は変更しない
-- - SECURITY DEFINER で RLS バイパス。返却フィールドは MANAGER_VISIBLE_FIELDS
--   （住所・電話・メール・給与等のプライベート項目は含めない）に限定
-- - 戻り値が jsonb なのは TypeScript 側のフィールド数 (~60) を SQL 上で
--   out 引数列挙するより jsonb_build_object 1 つで済むため

CREATE OR REPLACE FUNCTION public.get_subordinate_detail(p_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_me_id uuid;
  v_role text;
  v_tenant uuid;
  v_authorized boolean := false;
  v_result jsonb;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;

  SELECT e.id, e.role, e.tenant_id INTO v_me_id, v_role, v_tenant
  FROM public.employees e WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_me_id IS NULL THEN RETURN NULL; END IF;
  IF p_id = v_me_id THEN RETURN NULL; END IF;

  /* 対象が同テナントか確認 */
  PERFORM 1 FROM public.employees WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;

  /* admin / super_admin : 自テナント内なら誰でも可 */
  IF v_role IN ('admin', 'super_admin') THEN
    v_authorized := true;
  /* manager / shift_manager : 管轄施設に主所属または兼務している場合のみ */
  ELSIF v_role IN ('manager', 'shift_manager') THEN
    SELECT EXISTS (
      WITH managed_fids AS (
        SELECT facility_id FROM public.employees
          WHERE id = v_me_id AND facility_id IS NOT NULL
        UNION
        SELECT facility_id FROM public.manager_facilities
          WHERE employee_id = v_me_id
      )
      SELECT 1 FROM public.employees e
      LEFT JOIN public.employee_facilities ef ON ef.employee_id = e.id
      WHERE e.id = p_id
        AND (
          e.facility_id IN (SELECT facility_id FROM managed_fids)
          OR ef.facility_id IN (SELECT facility_id FROM managed_fids)
        )
    ) INTO v_authorized;
  END IF;

  IF NOT v_authorized THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'id', e.id,
    'tenant_id', e.tenant_id,
    'employee_number', e.employee_number,
    'status', e.status,
    'last_name', e.last_name,
    'first_name', e.first_name,
    'last_name_kana', e.last_name_kana,
    'first_name_kana', e.first_name_kana,
    'position', e.position,
    'years_of_service', e.years_of_service,
    'job_type', e.job_type,
    'work_location', e.work_location,
    'join_date', e.join_date,
    'has_car_commute', e.has_car_commute,
    'is_shuttle_driver', e.is_shuttle_driver,
    'driving_experience', e.driving_experience,
    'accident_history', e.accident_history,
    'training_attendance', e.training_attendance,
    'self_introduction', e.self_introduction,
    'current_duties', e.current_duties,
    'past_duties', e.past_duties,
    'qualifications', e.qualifications,
    'efforts_focused_on', e.efforts_focused_on,
    'how_others_describe', e.how_others_describe,
    'values_and_motivation', e.values_and_motivation,
    'work_style_solo_vs_team', e.work_style_solo_vs_team,
    'work_style_clear_vs_autonomy', e.work_style_clear_vs_autonomy,
    'work_style_stable_vs_change', e.work_style_stable_vs_change,
    'work_style_think_vs_act', e.work_style_think_vs_act,
    'multitask_ability', e.multitask_ability,
    'detail_orientation', e.detail_orientation,
    'comm_conclusion_vs_context', e.comm_conclusion_vs_context,
    'comm_consult_timing', e.comm_consult_timing,
    'comm_feedback_preference', e.comm_feedback_preference,
    'comm_channel_preference', e.comm_channel_preference,
    'meeting_behavior', e.meeting_behavior,
    'relationship_notes', e.relationship_notes,
    'strength_1', e.strength_1,
    'strength_2', e.strength_2,
    'strength_3', e.strength_3,
    'weakness_1', e.weakness_1,
    'weakness_2', e.weakness_2,
    'weakness_3', e.weakness_3,
    'success_experience', e.success_experience,
    'success_reason', e.success_reason,
    'struggle_experience', e.struggle_experience,
    'struggle_reason', e.struggle_reason,
    'suited_tasks', e.suited_tasks,
    'burden_tasks', e.burden_tasks,
    'workplace_values', e.workplace_values,
    'ideal_boss_colleague', e.ideal_boss_colleague,
    'disliked_atmosphere', e.disliked_atmosphere,
    'growth_goal', e.growth_goal,
    'preferred_evaluation', e.preferred_evaluation,
    'safe_environment', e.safe_environment,
    'strengths_self_reported', e.strengths_self_reported,
    'work_style_preference', e.work_style_preference,
    'team_role_preference', e.team_role_preference,
    'easy_to_work_with', e.easy_to_work_with,
    'hard_to_work_with', e.hard_to_work_with,
    'team_mindset', e.team_mindset,
    'facility', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object('name', f.name) END
  )
  INTO v_result
  FROM public.employees e
  LEFT JOIN public.facilities f ON f.id = e.facility_id
  WHERE e.id = p_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

COMMENT ON FUNCTION public.get_subordinate_detail(uuid) IS
  '部下プロフィール詳細を MANAGER_VISIBLE_FIELDS のみで返す。admin / manager / shift_manager 用。RLS バイパス。';
