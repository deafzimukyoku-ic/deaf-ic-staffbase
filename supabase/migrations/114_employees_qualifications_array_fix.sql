-- 114_employees_qualifications_array_fix.sql
-- 003_employees で text として作られた qualifications を text[] に変換する。
-- 104_shift_settings_extend の `add column if not exists qualifications text[]` は
-- 既存 text 列があるため skip され、結果として型ズレが発生していたのを是正。
-- 既存 text 値は CSV として split_to_array、空/NULL は '{}' に正規化。

do $$
declare
  col_type text;
begin
  select data_type into col_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'employees'
     and column_name = 'qualifications';

  if col_type = 'text' then
    alter table public.employees
      alter column qualifications drop default;

    alter table public.employees
      alter column qualifications type text[]
      using case
        when qualifications is null or btrim(qualifications) = '' then '{}'::text[]
        else string_to_array(qualifications, ',')
      end;

    alter table public.employees
      alter column qualifications set default '{}'::text[];

    alter table public.employees
      alter column qualifications set not null;
  end if;
end$$;

comment on column public.employees.qualifications is
  'facility_shift_settings.qualification_types から選ばれた名前の配列';
