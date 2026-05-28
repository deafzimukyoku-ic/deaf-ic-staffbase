-- 214_shift_manager_staff_edit_rpc.sql
-- shift_manager（および manager / admin）が「職員のシフト系項目」を更新できる RPC を追加する。
--
-- 背景:
--   employees の RLS は UPDATE が admin / 本人 / manager(subordinate) のみで、
--   shift_manager には付与されていない（migration 140 では employees を触っていない）。
--   employees を直接 RLS 開放すると role・給与など全カラムが書き換え可能になり、
--   shift_manager による権限昇格（自分を admin に変更等）のリスクがある。
--   そこで「更新できるカラムを限定した SECURITY DEFINER RPC」を用意し、
--   フロント（StaffSettingsFull）から shift_manager はこの RPC 経由で更新する。
--
-- 触れるカラム: シフト・送迎運用に必要な 9 項目 + 並び順（shift_display_order）のみ。
--   氏名・連絡先・生年月日・銀行・保険・role には一切触れない。
--
-- 認可:
--   - 未認証 / admin・manager・shift_manager 以外 → 例外
--   - admin → 同テナント内の任意の職員
--   - manager / shift_manager → get_my_managed_facility_ids() に含まれる施設に
--       主所属 or 兼任する職員のみ
--
-- employees の RLS ポリシー自体は変更しない（RPC が SECURITY DEFINER で内部検証する）。

-- ============================================================
-- 1. シフト系9項目の更新
-- ============================================================
create or replace function public.update_staff_shift_fields(
  p_employee_id uuid,
  p_employment_type text,
  p_default_start_time time,
  p_default_end_time time,
  p_pickup_transport_areas text[],
  p_dropoff_transport_areas text[],
  p_shift_qualifications text[],
  p_is_qualified boolean,
  p_is_driver boolean,
  p_is_attendant boolean
) returns void as $$
declare
  v_role text;
  v_tenant uuid;
  v_target_facility uuid;
  v_target_tenant uuid;
begin
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e where e.auth_user_id = auth.uid() limit 1;
  if v_tenant is null then raise exception '認証が必要です'; end if;
  if v_role not in ('admin', 'manager', 'shift_manager') then
    raise exception '権限がありません';
  end if;

  select e.facility_id, e.tenant_id into v_target_facility, v_target_tenant
  from public.employees e where e.id = p_employee_id limit 1;
  if v_target_tenant is null or v_target_tenant <> v_tenant then
    raise exception '対象の職員が見つかりません';
  end if;

  /* manager / shift_manager は自管轄施設（主所属 or 兼任）の職員のみ */
  if v_role in ('manager', 'shift_manager') then
    if not exists (
      select 1 from public.get_my_managed_facility_ids() m
      where m = v_target_facility
         or m in (
           select ef.facility_id from public.employee_facilities ef
            where ef.employee_id = p_employee_id
         )
    ) then
      raise exception '権限がありません（担当外の事業所の職員です）';
    end if;
  end if;

  update public.employees set
    employment_type = p_employment_type,
    default_start_time = p_default_start_time,
    default_end_time = p_default_end_time,
    pickup_transport_areas = p_pickup_transport_areas,
    dropoff_transport_areas = p_dropoff_transport_areas,
    shift_qualifications = p_shift_qualifications,
    is_qualified = p_is_qualified,
    is_driver = p_is_driver,
    is_attendant = p_is_attendant
  where id = p_employee_id;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.update_staff_shift_fields(
  uuid, text, time, time, text[], text[], text[], boolean, boolean, boolean
) to authenticated;

comment on function public.update_staff_shift_fields(
  uuid, text, time, time, text[], text[], text[], boolean, boolean, boolean
) is
  'migration 214: 職員のシフト系9項目のみを更新する RPC。role・給与・氏名には触れない。admin=テナント内 / manager・shift_manager=自管轄施設(主所属 or 兼任)の職員のみ。';

-- ============================================================
-- 2. 並び順（shift_display_order）の一括更新
-- ============================================================
create or replace function public.reorder_staff_shift_orders(p_ordered_ids uuid[])
returns void as $$
declare
  v_role text;
  v_tenant uuid;
  i int;
begin
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e where e.auth_user_id = auth.uid() limit 1;
  if v_tenant is null then raise exception '認証が必要です'; end if;
  if v_role not in ('admin', 'manager', 'shift_manager') then
    raise exception '権限がありません';
  end if;

  for i in 1 .. coalesce(array_length(p_ordered_ids, 1), 0) loop
    update public.employees e set shift_display_order = i - 1
    where e.id = p_ordered_ids[i]
      and e.tenant_id = v_tenant
      and (
        v_role = 'admin'
        or exists (
          select 1 from public.get_my_managed_facility_ids() m
          where m = e.facility_id
             or m in (
               select ef.facility_id from public.employee_facilities ef
                where ef.employee_id = e.id
             )
        )
      );
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.reorder_staff_shift_orders(uuid[]) to authenticated;

comment on function public.reorder_staff_shift_orders(uuid[]) is
  'migration 214: 職員の shift_display_order を 0 始まりで一括更新する RPC。admin=テナント内 / manager・shift_manager=自管轄施設(主所属 or 兼任)の職員のみ。';
