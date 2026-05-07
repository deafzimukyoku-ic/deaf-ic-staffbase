-- 155_get_facility_members_rpc.sql
-- migration 154 (get_facility_member_ids) は ID リストだけ返す軽量版だったが、
-- 取得後に from('employees').select(...).in('id', ids) を呼ぶと
-- employees の RLS が再び効いて結局自分の行しか返らない（manager / shift_manager）。
-- 必要なカラム全体を SECURITY DEFINER で返す方式に拡張する。
--
-- 機密情報（住所・電話・birth_date・銀行・保険番号）は含めない。
-- シフト・送迎・職員管理 UI で必要な列のみ。

create or replace function public.get_facility_members(p_facility_id uuid)
returns table (
  id uuid,
  tenant_id uuid,
  facility_id uuid,
  employee_number text,
  last_name text,
  first_name text,
  email text,
  role text,
  status text,
  employment_type text,
  default_start_time time,
  default_end_time time,
  pickup_transport_areas text[],
  dropoff_transport_areas text[],
  qualifications text[],
  shift_qualifications text[],
  is_qualified boolean,
  is_driver boolean,
  is_attendant boolean,
  shift_display_order integer,
  join_date date,
  employee_position text
) as $$
declare
  v_role text;
  v_tenant uuid;
  v_facility_tenant uuid;
begin
  /* 認証 + 自テナント取得 */
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e
  where e.auth_user_id = auth.uid()
  limit 1;

  if v_tenant is null then return; end if;

  /* 認可: admin / manager / shift_manager のみ */
  if v_role not in ('admin', 'manager', 'shift_manager') then return; end if;

  /* facility が同テナントか */
  select f.tenant_id into v_facility_tenant
  from public.facilities f where f.id = p_facility_id limit 1;

  if v_facility_tenant is null or v_facility_tenant <> v_tenant then return; end if;

  /* manager / shift_manager は自管轄 facility のみ */
  if v_role in ('manager', 'shift_manager') then
    if not exists (
      select 1 from public.get_my_managed_facility_ids() m
      where m = p_facility_id
    ) then
      return;
    end if;
  end if;

  /* 主所属 + 兼任を union。各職員の属性は employees から取得（同 ID で重複しないよう DISTINCT ON） */
  return query
  select distinct on (e.id)
    e.id,
    e.tenant_id,
    e.facility_id,
    e.employee_number,
    e.last_name,
    e.first_name,
    e.email,
    e.role,
    e.status,
    e.employment_type,
    e.default_start_time,
    e.default_end_time,
    e.pickup_transport_areas,
    e.dropoff_transport_areas,
    e.qualifications,
    e.shift_qualifications,
    e.is_qualified,
    e.is_driver,
    e.is_attendant,
    e.shift_display_order,
    e.join_date,
    e.position as employee_position
  from public.employees e
  left join public.employee_facilities ef on ef.employee_id = e.id
  where e.tenant_id = v_tenant
    and (e.facility_id = p_facility_id or ef.facility_id = p_facility_id);
end;
$$ language plpgsql security definer set search_path = public stable;

grant execute on function public.get_facility_members(uuid) to authenticated;

comment on function public.get_facility_members(uuid) is
  'Phase 70 fix: 指定 facility に所属する全職員（主所属 + 兼任）の運用属性を RLS バイパスで返す。admin / manager / shift_manager のみ呼べる。manager / shift_manager は自管轄 facility のみ。住所・電話など機密項目は含めない。';
