-- 135_align_employee_columns_to_code.sql
-- migration 012 が一部環境で適用されておらず、コード (lib/types.ts) が期待する
-- employees カラム群が DB に存在しなかった。
-- - 012 は car_type / insurance_certificate_number / commute_distance_km / insurance_period_*
--   という名前で作っていたがコード側は car_model / insurance_policy_number /
--   commute_distance / insurance_expiry を使っており、整合してなかった
-- - さらに 012 自体が未適用の環境もあり、「列が見つからない」エラーが発生していた
--
-- 本 migration は「コードが使う名前で全部 add column if not exists」する形で
-- 何度実行しても安全 (idempotent) に整える。古い名前のカラムが残っていても
-- 害はないが、今後コードからは新名前のみ使う。

-- 車・運転免許関連
alter table public.employees add column if not exists car_model              text;
alter table public.employees add column if not exists car_plate_number       text;
alter table public.employees add column if not exists license_type           text;
alter table public.employees add column if not exists license_number         text;
alter table public.employees add column if not exists insurance_company      text;
alter table public.employees add column if not exists insurance_policy_number text;
alter table public.employees add column if not exists insurance_expiry       text;
alter table public.employees add column if not exists commute_distance       text;

-- 送迎運転者関連
alter table public.employees add column if not exists driving_experience    text;
alter table public.employees add column if not exists accident_history      text;
alter table public.employees add column if not exists training_attendance   text;

-- 緊急連絡先 1
alter table public.employees add column if not exists emergency1_name         text;
alter table public.employees add column if not exists emergency1_relationship text;
alter table public.employees add column if not exists emergency1_phone        text;
alter table public.employees add column if not exists emergency1_mobile       text;
alter table public.employees add column if not exists emergency1_postal_code  text;
alter table public.employees add column if not exists emergency1_address      text;

-- 緊急連絡先 2
alter table public.employees add column if not exists emergency2_name         text;
alter table public.employees add column if not exists emergency2_relationship text;
alter table public.employees add column if not exists emergency2_phone        text;
alter table public.employees add column if not exists emergency2_mobile       text;
alter table public.employees add column if not exists emergency2_postal_code  text;
alter table public.employees add column if not exists emergency2_address      text;

-- 身元保証人
alter table public.employees add column if not exists guarantor_name         text;
alter table public.employees add column if not exists guarantor_birth_date   text;
alter table public.employees add column if not exists guarantor_postal_code  text;
alter table public.employees add column if not exists guarantor_address      text;
alter table public.employees add column if not exists guarantor_phone        text;
alter table public.employees add column if not exists guarantor_relationship text;
