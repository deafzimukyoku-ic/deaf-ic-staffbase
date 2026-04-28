-- 124_attendance_waitlist.sql
-- Phase 64: キャンセル待ち (waitlist) を出欠ステータスとして追加
-- - schedule_entries.attendance_status の CHECK を貼り直し（'waitlist' を追加）
-- - schedule_entries.waitlist_order smallint NULL を追加（1〜10、waitlist 以外は NULL 強制）
-- - update_schedule_entry_attendance RPC を 第3引数 p_waitlist_order smallint default null で再定義
--   既存の 2 引数呼び出しはデフォルト NULL でそのまま動作（後方互換）

-- 1) attendance_status の CHECK 貼り直し（'leave' は migration 105 で既に追加済み、ここで 'waitlist' を追加）
alter table public.schedule_entries
  drop constraint if exists schedule_entries_attendance_status_check;
alter table public.schedule_entries
  add constraint schedule_entries_attendance_status_check
  check (attendance_status in ('planned','present','absent','late','early_leave','leave','waitlist'));

comment on column public.schedule_entries.attendance_status is
  '出欠ステータス。planned=予定／present=出席／absent=欠席／late=遅刻／early_leave=早退／leave=お休み／waitlist=キャンセル待ち';

-- 2) waitlist_order カラム追加（1〜10、waitlist 以外は NULL を強制）
alter table public.schedule_entries
  add column if not exists waitlist_order smallint null;

alter table public.schedule_entries
  drop constraint if exists schedule_entries_waitlist_order_range;
alter table public.schedule_entries
  add constraint schedule_entries_waitlist_order_range
  check (waitlist_order is null or (waitlist_order between 1 and 10));

alter table public.schedule_entries
  drop constraint if exists schedule_entries_waitlist_order_only_for_waitlist;
alter table public.schedule_entries
  add constraint schedule_entries_waitlist_order_only_for_waitlist
  check (waitlist_order is null or attendance_status = 'waitlist');

comment on column public.schedule_entries.waitlist_order is
  'Phase 64: キャンセル待ちの順番 (1〜10)。waitlist 以外は NULL。同日内で重複可（兄弟想定）。';

-- 3) RPC 再定義: 第3引数 p_waitlist_order smallint default null
--    既存の 2 引数呼び出しはデフォルト NULL でそのまま動作する。
drop function if exists public.update_schedule_entry_attendance(uuid, text);
drop function if exists public.update_schedule_entry_attendance(uuid, text, smallint);

create or replace function public.update_schedule_entry_attendance(
  p_entry_id uuid,
  p_status text,
  p_waitlist_order smallint default null
) returns public.schedule_entries
language plpgsql security definer set search_path = public as $$
declare
  v_employee record;
  v_entry public.schedule_entries;
  v_old_status text;
  v_old_order smallint;
  v_new_order smallint;
  v_name text;
begin
  -- セッションから職員情報取得（無効/未ログインは弾く）
  select id, tenant_id into v_employee
    from public.employees
    where auth_user_id = auth.uid() and status = 'active'
    limit 1;
  if v_employee.id is null then
    raise exception 'Login required or user inactive' using errcode = '42501';
  end if;

  if p_status not in ('planned','present','absent','late','early_leave','leave','waitlist') then
    raise exception 'Invalid attendance status: %', p_status using errcode = '22023';
  end if;

  -- waitlist 以外は order を強制 NULL。waitlist で範囲外なら拒否。
  if p_status = 'waitlist' then
    if p_waitlist_order is not null and (p_waitlist_order < 1 or p_waitlist_order > 10) then
      raise exception 'キャンセル待ちの順番は 1〜10 で指定してください' using errcode = '22023';
    end if;
    v_new_order := p_waitlist_order;
  else
    v_new_order := null;
  end if;

  select * into v_entry from public.schedule_entries
    where id = p_entry_id and tenant_id = v_employee.tenant_id
    for update;
  if v_entry.id is null then
    raise exception 'Schedule entry not found' using errcode = 'P0002';
  end if;

  v_old_status := v_entry.attendance_status;
  v_old_order  := v_entry.waitlist_order;

  -- status も order も同一なら no-op
  if v_old_status = p_status and coalesce(v_old_order, -1) = coalesce(v_new_order, -1) then
    return v_entry;
  end if;

  update public.schedule_entries
    set attendance_status = p_status,
        waitlist_order = v_new_order,
        attendance_updated_at = now(),
        attendance_updated_by = v_employee.id
    where id = p_entry_id
    returning * into v_entry;

  -- 履歴は status 変更時のみ記録（順番だけの変更で audit log を膨らませない）
  if v_old_status <> p_status then
    select coalesce(last_name,'') || ' ' || coalesce(first_name,'') into v_name
      from public.employees where id = v_employee.id;

    insert into public.attendance_audit_logs (
      tenant_id, facility_id, schedule_entry_id, child_id, entry_date,
      changed_by_employee_id, changed_by_name, old_status, new_status
    ) values (
      v_entry.tenant_id, v_entry.facility_id, v_entry.id, v_entry.child_id, v_entry.date,
      v_employee.id, v_name, v_old_status, p_status
    );
  end if;

  return v_entry;
end;
$$;

grant execute on function public.update_schedule_entry_attendance(uuid, text, smallint) to authenticated;
