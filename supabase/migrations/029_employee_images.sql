-- 029: 社員画像カラム追加
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS license_image_path text,
  ADD COLUMN IF NOT EXISTS commute_route_image_path text;
