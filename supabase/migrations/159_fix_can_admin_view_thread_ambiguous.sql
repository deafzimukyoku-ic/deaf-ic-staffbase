-- 159: can_admin_view_thread() の facility_id ambiguous エラー修正
--
-- 背景:
-- migration 142 で個別メッセージ機能を追加した際の can_admin_view_thread() 関数内、
-- 138 行目で「SELECT facility_id FROM public.manager_facilities mf
--           JOIN public.employees e ON e.id = mf.employee_id ...」と書かれており、
-- manager_facilities にも employees にも facility_id 列があるため
-- PostgreSQL が "column reference \"facility_id\" is ambiguous" (SQLSTATE 42702) を投げる。
--
-- これまで顕在化しなかった理由:
--   - notifications テーブルの INSERT ポリシーが migration 139 時点で欠落しており、
--     個別メッセージ送信は notifications 側で 403 になって早期に失敗していた
--   - 158 で notifications の INSERT が通るようになった結果、
--     後続の messages.insert.select() RETURNING の RLS 評価で
--     can_admin_view_thread() が manager 経路で完全実行されるようになり、
--     潜んでいたバグが顕在化
--
-- 修正:
--   - 138 行目を `SELECT mf.facility_id FROM ...` に変更（テーブル修飾子を付与）
--   - 関数全体を CREATE OR REPLACE で置き換え
--
-- 注意 (本コミットでは触らない別バグ):
--   - 同関数の v_role = 'manager' チェックは shift_manager を含んでいない。
--     現状 shift_manager は admin/manager 経由のメッセージ閲覧ができないが、
--     これは設計判断であり別途検討。今回は ambiguous の修正のみ。

begin;

create or replace function public.can_admin_view_thread(p_thread_id uuid) returns boolean as $$
declare
  v_role text;
  v_tenant uuid;
  v_my_facilities uuid[];
begin
  select role, tenant_id into v_role, v_tenant from public.employees where auth_user_id = auth.uid() limit 1;
  if v_role is null then return false; end if;
  if v_role = 'admin' then
    return exists (select 1 from public.message_threads where id = p_thread_id and tenant_id = v_tenant);
  end if;
  if v_role = 'manager' then
    select array_agg(facility_id) into v_my_facilities
    from (
      select facility_id from public.employees where auth_user_id = auth.uid()
      union
      select mf.facility_id from public.manager_facilities mf  -- ← テーブル修飾子追加: ambiguous 修正
      join public.employees e on e.id = mf.employee_id where e.auth_user_id = auth.uid()
    ) s;
    return exists (
      select 1 from public.message_thread_members tm
      join public.employees em on em.id = tm.employee_id
      where tm.thread_id = p_thread_id and em.facility_id = any(v_my_facilities)
    );
  end if;
  return false;
end;
$$ language plpgsql security definer set search_path = public stable;

commit;

notify pgrst, 'reload schema';
