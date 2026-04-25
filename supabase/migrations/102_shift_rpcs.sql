-- 102_shift_rpcs.sql
-- Shift-Maker RPC: 出欠更新（監査ログ自動記録）、シフト変更申請 承認/却下

-- ============================================================
-- update_schedule_entry_attendance
-- ============================================================
drop function if exists public.update_schedule_entry_attendance(uuid, text);
create or replace function public.update_schedule_entry_attendance(
  p_entry_id uuid,
  p_status text
) returns public.schedule_entries
language plpgsql security definer set search_path = public as $$
declare
  v_employee record;
  v_entry public.schedule_entries;
  v_old_status text;
  v_name text;
begin
  select id, tenant_id into v_employee
    from public.employees
    where auth_user_id = auth.uid() and status = 'active'
    limit 1;
  if v_employee.id is null then
    raise exception 'Login required or user inactive' using errcode = '42501';
  end if;

  if p_status not in ('planned','present','absent','late','early_leave') then
    raise exception 'Invalid attendance status: %', p_status using errcode = '22023';
  end if;

  select * into v_entry from public.schedule_entries
    where id = p_entry_id and tenant_id = v_employee.tenant_id
    for update;
  if v_entry.id is null then
    raise exception 'Schedule entry not found' using errcode = 'P0002';
  end if;

  v_old_status := v_entry.attendance_status;
  if v_old_status = p_status then
    return v_entry;
  end if;

  update public.schedule_entries
    set attendance_status = p_status,
        attendance_updated_at = now(),
        attendance_updated_by = v_employee.id
    where id = p_entry_id
    returning * into v_entry;

  select coalesce(last_name,'') || ' ' || coalesce(first_name,'') into v_name
    from public.employees where id = v_employee.id;

  insert into public.attendance_audit_logs (
    tenant_id, facility_id, schedule_entry_id, child_id, entry_date,
    changed_by_employee_id, changed_by_name, old_status, new_status
  ) values (
    v_entry.tenant_id, v_entry.facility_id, v_entry.id, v_entry.child_id, v_entry.date,
    v_employee.id, v_name, v_old_status, p_status
  );

  return v_entry;
end;
$$;

grant execute on function public.update_schedule_entry_attendance(uuid, text) to authenticated;

-- ============================================================
-- approve_shift_change_request
-- ============================================================
drop function if exists public.approve_shift_change_request(uuid, text);
create or replace function public.approve_shift_change_request(
  p_request_id uuid,
  p_admin_note text default null
) returns public.shift_change_requests
language plpgsql security definer set search_path = public as $$
declare
  v_admin record;
  v_request public.shift_change_requests;
  v_payload jsonb;
  v_name text;
begin
  select id, tenant_id into v_admin
    from public.employees
    where auth_user_id = auth.uid() and role = 'admin' and status = 'active'
    limit 1;
  if v_admin.id is null then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  select * into v_request from public.shift_change_requests
    where id = p_request_id and tenant_id = v_admin.tenant_id
    for update;
  if v_request.id is null then
    raise exception 'Shift change request not found' using errcode = 'P0002';
  end if;
  if v_request.status != 'pending' then
    raise exception 'Request must be pending' using errcode = '22023';
  end if;

  select coalesce(last_name,'') || ' ' || coalesce(first_name,'') into v_name
    from public.employees where id = v_admin.id;

  update public.shift_change_requests
    set status = 'approved',
        reviewed_by_employee_id = v_admin.id,
        reviewed_by_name = v_name,
        reviewed_at = now(),
        admin_note = p_admin_note
    where id = p_request_id
    returning * into v_request;

  v_payload := v_request.requested_payload;

  if v_request.change_type = 'time' then
    update public.shift_assignments
      set start_time = coalesce((v_payload->>'start_time')::time, start_time),
          end_time = coalesce((v_payload->>'end_time')::time, end_time)
      where employee_id = v_request.employee_id
        and date = v_request.target_date
        and tenant_id = v_request.tenant_id;
  elsif v_request.change_type = 'leave' then
    update public.shift_assignments
      set assignment_type = coalesce(v_payload->>'assignment_type', 'off')
      where employee_id = v_request.employee_id
        and date = v_request.target_date
        and tenant_id = v_request.tenant_id;
  elsif v_request.change_type = 'type_change' then
    update public.shift_assignments
      set assignment_type = coalesce(v_payload->>'assignment_type', 'normal')
      where employee_id = v_request.employee_id
        and date = v_request.target_date
        and tenant_id = v_request.tenant_id;
  end if;

  return v_request;
end;
$$;

grant execute on function public.approve_shift_change_request(uuid, text) to authenticated;

-- ============================================================
-- reject_shift_change_request
-- ============================================================
drop function if exists public.reject_shift_change_request(uuid, text);
create or replace function public.reject_shift_change_request(
  p_request_id uuid,
  p_admin_note text default null
) returns public.shift_change_requests
language plpgsql security definer set search_path = public as $$
declare
  v_admin record;
  v_request public.shift_change_requests;
  v_name text;
begin
  select id, tenant_id into v_admin
    from public.employees
    where auth_user_id = auth.uid() and role = 'admin' and status = 'active'
    limit 1;
  if v_admin.id is null then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  select coalesce(last_name,'') || ' ' || coalesce(first_name,'') into v_name
    from public.employees where id = v_admin.id;

  update public.shift_change_requests
    set status = 'rejected',
        reviewed_by_employee_id = v_admin.id,
        reviewed_by_name = v_name,
        reviewed_at = now(),
        admin_note = p_admin_note
    where id = p_request_id and tenant_id = v_admin.tenant_id
    returning * into v_request;

  if v_request.id is null then
    raise exception 'Request not found or access denied' using errcode = 'P0002';
  end if;
  return v_request;
end;
$$;

grant execute on function public.reject_shift_change_request(uuid, text) to authenticated;
