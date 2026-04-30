-- 135_align_employee_columns_to_code.sql
-- migration 012 で追加した employees の以下カラム名がコード側 (lib/types.ts) と
-- 一致していなかった (migration 014 の注釈は誤り)。8 ファイル × 多数の参照が
-- code 側にあるため、DB 側をリネームして整合させる。
--
-- 旧名 (DB)                          → 新名 (コードが使う名前)
--   car_type                           → car_model
--   insurance_certificate_number       → insurance_policy_number
--   commute_distance_km (numeric)      → commute_distance (text)
--   insurance_period_start/end (date)  → insurance_expiry (text)
--
-- 既存データは admin 1 名 + 値未入力（cleanup 直後）のため drop & add で安全。
-- データを残したい場合は手動でキャスト変換すること。
--
-- if exists ガードでマルチ環境（既に整合している場合）でも安全に実行可能。

do $$
begin
  -- car_model: rename if old column exists
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'car_type') then
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'employees'
                      and column_name = 'car_model') then
      alter table public.employees rename column car_type to car_model;
    else
      alter table public.employees drop column car_type;
    end if;
  end if;

  -- insurance_policy_number: rename if old column exists
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'insurance_certificate_number') then
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'employees'
                      and column_name = 'insurance_policy_number') then
      alter table public.employees rename column insurance_certificate_number to insurance_policy_number;
    else
      alter table public.employees drop column insurance_certificate_number;
    end if;
  end if;

  -- commute_distance: drop old numeric, add text (型が違うので rename ではなく drop & add)
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'commute_distance_km') then
    alter table public.employees drop column commute_distance_km;
  end if;

  -- insurance_expiry: drop old date pair, add text
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'insurance_period_start') then
    alter table public.employees drop column insurance_period_start;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'insurance_period_end') then
    alter table public.employees drop column insurance_period_end;
  end if;
end$$;

-- 新カラムを add column if not exists で確実に存在させる
alter table public.employees add column if not exists car_model              text;
alter table public.employees add column if not exists insurance_policy_number text;
alter table public.employees add column if not exists commute_distance        text;
alter table public.employees add column if not exists insurance_expiry        text;
