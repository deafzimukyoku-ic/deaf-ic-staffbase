-- 132_protect_employee_email.sql
-- employees.email の直接 UPDATE を block する保護トリガ。
--
-- 背景:
--   - 旧仕様では admin が UI から employees.email を直接書き換えられたが、
--     auth.users.email は同期されず → 旧 email でしかログインできなくなる事故があった
--   - また employees の self-update RLS で employee 本人による email 自己変更も理論上可能だった
--
-- 対策:
--   - 本トリガで「email カラムが変化する UPDATE」を block する
--   - 例外: service_role 経由の更新は許可 (Supabase admin API / 専用 API ルート)
--     → /api/employees/[id]/email POST が auth.users と employees を両方更新する正規パス
--
-- service_role 判定:
--   PostgREST は JWT の role claim を request.jwt.claim.role に流す。
--   service_role キーで投げられたリクエストは role='service_role'。
--   それ以外 (anon / authenticated) は block される。

create or replace function public.protect_employees_email_update()
returns trigger as $$
declare
  jwt_role text;
begin
  if NEW.email is distinct from OLD.email then
    -- service_role 以外は email 変更を block
    jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');
    if jwt_role <> 'service_role' then
      raise exception 'employees.email は専用 API (/api/employees/[id]/email) 経由でのみ変更できます'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists employees_protect_email_update on public.employees;
create trigger employees_protect_email_update
  before update of email on public.employees
  for each row execute function public.protect_employees_email_update();

comment on function public.protect_employees_email_update() is
  'employees.email を service_role 以外の経路から書き換えられないようにする保護トリガ。'
  ' admin UI からの変更は /api/employees/[id]/email POST（auth.users と同期）を経由させる。';
