-- 014: docxタグに合わせてemployeesカラム追加
-- 注: car_model, insurance_policy_number, insurance_expiry, commute_distance は
--     012 で正しい名前で作成済み。追加分のみ。
-- 適用済み: 2026-04-12

ALTER TABLE employees ADD COLUMN IF NOT EXISTS license_expiry text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS vehicle_inspection_expiry text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS parking_location text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS my_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS previous_employer text;
