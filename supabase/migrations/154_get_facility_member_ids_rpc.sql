-- 154_get_facility_member_ids_rpc.sql
-- 送迎表 / シフト表 / 利用料金表で使う「facility に所属する職員 ID 一覧」を SECURITY DEFINER で返す。
--
-- 背景:
--   lib/multi-facility.ts の fetchFacilityMemberIds() は employees / employee_facilities を
--   直接 SELECT しているが、employees の RLS は migration 010 で
--   「自分のみ」と「admin のみ tenant 全件」しか定義されていない。
--   migration 144 で manager / shift_manager にも SELECT を許可しようとしたが
--   「全員ログアウト」現象が発生し 145 でロールバック済。代わりに SECURITY DEFINER RPC で
--   必要な集合だけ返す方式に統一する（migration 146 get_my_subordinates と同じ設計）。
--
--   shift_manager (シフト統括) で送迎表を開くと「自分 1 人だけ」になる現象を解消する。
--   manager / admin で同じ画面を開いた場合も同等以上の挙動になる。
--
-- 認可:
--   - 未認証 / 自テナント以外の facility / employee ロール → 空
--   - admin → 同テナント内の任意 facility
--   - manager / shift_manager → get_my_managed_facility_ids() に含まれる facility のみ

create or replace function public.get_facility_member_ids(p_facility_id uuid)
returns table (id uuid) as $$
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

  /* 主所属 + 兼任の全 employee_id を返す */
  return query
  select distinct u.emp_id from (
    select e.id as emp_id from public.employees e where e.facility_id = p_facility_id
    union
    select ef.employee_id as emp_id from public.employee_facilities ef where ef.facility_id = p_facility_id
  ) u;
end;
$$ language plpgsql security definer set search_path = public stable;

grant execute on function public.get_facility_member_ids(uuid) to authenticated;

comment on function public.get_facility_member_ids(uuid) is
  'Phase 70 fix: 指定 facility に所属する全職員 ID（主所属 + 兼任）を RLS バイパスで返す。admin / manager / shift_manager のみ呼べる。manager / shift_manager は自管轄 facility のみ。';
