-- 012: マイカー通勤詳細・送迎運転者詳細・緊急連絡先・身元保証人カラム追加
-- 全て nullable（プロフィール段階的入力のため）

-- ===== マイカー通勤関連 (has_car_commute=true 時に使用) =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS car_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS car_plate_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS license_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS license_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_company text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_certificate_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_period_start date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_period_end date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS commute_distance_km numeric;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS commute_route text;

-- ===== 送迎運転者関連 (is_shuttle_driver=true 時に使用) =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS driving_experience text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS accident_history text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS training_attendance text;

-- ===== 緊急連絡先1 =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_relationship text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_mobile text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_postal_code text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency1_address text;

-- ===== 緊急連絡先2 =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_relationship text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_mobile text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_postal_code text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency2_address text;

-- ===== 身元保証人 =====
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_birth_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_postal_code text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_address text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS guarantor_relationship text;
