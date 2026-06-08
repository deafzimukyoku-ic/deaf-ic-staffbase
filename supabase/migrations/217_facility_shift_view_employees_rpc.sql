-- 217_facility_shift_view_employees_rpc.sql
--
-- /my/requests?tab=facility-shift で employee が自分しか見えなかったバグの修正。
--
-- 真因:
--   1) employees の RLS は migration 000「employee can read self」で auth_user_id = auth.uid()
--      のみ SELECT 可。同 facility の他社員は弾かれていた。
--   2) 既存 SECURITY DEFINER RPC `get_facility_members`(155) は
--      `if v_role not in ('admin','manager','shift_manager') then return; end if;` で
--      employee ロールを明示的に弾いており、employee からは空配列が返っていた。
--
-- 結果として MyFacilityShiftView は shift_assignments を employee 視点でも全社員分 SELECT
-- できる(160/216)のに、employees 行は自分しか返らず、表に自分しか描画されなかった。
--
-- 対応:
--   全ロール(admin/manager/shift_manager/employee)が、自分の見える facility に所属する
--   全社員 (主+兼任) の**シフト表描画に必要な最小限の列のみ**を取得できる SECURITY DEFINER
--   RPC を新設する。住所・電話・birth_date・銀行・保険番号など機密項目は一切返さない。
--
-- プライバシー判断 (CLAUDE.md §9, §10 のろう者納品仕様 + 既存運用に準拠):
--   - shift_assignments の壁掲示と同等情報のみ
--   - 名前 / 所属 facility / シフト並び順 / 既定開始/終了時刻
--   - email や 資格 / 連絡先は含めない (manager/admin はそれらは get_facility_members を使う)

create or replace function public.get_my_facility_shift_view_employees(p_facility_ids uuid[])
returns table (
  id uuid,
  last_name text,
  first_name text,
  facility_id uuid,
  shift_display_order integer,
  default_start_time time,
  default_end_time time
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text;
  v_tenant uuid;
  v_allowed uuid[];
begin
  if p_facility_ids is null or array_length(p_facility_ids, 1) is null then
    return;
  end if;

  /* 自分の役割 + tenant を取得 */
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e
  where e.auth_user_id = auth.uid()
  limit 1;

  if v_tenant is null then return; end if;
  if v_role not in ('admin', 'manager', 'shift_manager', 'employee') then return; end if;

  /* 役割ごとに「アクセス許可される facility 集合」と p_facility_ids の積集合を取る。
     - admin: 同テナントの全 facility (要求された ID のみ)
     - manager / shift_manager: 自管轄 facility のみ
     - employee: 自分の所属 facility (主+兼任 = get_my_facility_ids) */
  if v_role = 'admin' then
    select array_agg(f.id) into v_allowed
    from public.facilities f
    where f.tenant_id = v_tenant and f.id = any(p_facility_ids);
  elsif v_role in ('manager', 'shift_manager') then
    select array_agg(m) into v_allowed
    from public.get_my_managed_facility_ids() as m
    where m = any(p_facility_ids);
  else
    /* employee */
    select array_agg(m) into v_allowed
    from public.get_my_facility_ids() as m
    where m = any(p_facility_ids);
  end if;

  if v_allowed is null or array_length(v_allowed, 1) is null then
    return;
  end if;

  /* 主所属 + 兼任を union (employee_facilities)。同職員が複数施設に所属していても
     1 行に集約 (distinct on)。シフト表は employee_id をキーにセル展開するため重複は不可。
     - facility_id は主所属を優先 (e.facility_id) して返す。employee_facilities で
       兼任先側 facility を表示したい UI なら別途 employee_facilities を引く。
     - status='active' 限定。退職者は表示しない。 */
  return query
  select distinct on (e.id)
    e.id,
    e.last_name,
    e.first_name,
    e.facility_id,
    e.shift_display_order,
    e.default_start_time,
    e.default_end_time
  from public.employees e
  left join public.employee_facilities ef on ef.employee_id = e.id
  where e.tenant_id = v_tenant
    and e.status = 'active'
    and (e.facility_id = any(v_allowed) or ef.facility_id = any(v_allowed))
  order by e.id, e.shift_display_order nulls last, e.last_name;
end;
$$;

grant execute on function public.get_my_facility_shift_view_employees(uuid[]) to authenticated;

comment on function public.get_my_facility_shift_view_employees(uuid[]) is
  '社員シフト表 (/my/requests?tab=facility-shift) 専用: 自分の所属 facility に居る全社員の最小限の表示属性を返す。RLS バイパス (SECURITY DEFINER)。全ロール対応 (employee も可)。機密情報は返さない。';

notify pgrst, 'reload schema';
