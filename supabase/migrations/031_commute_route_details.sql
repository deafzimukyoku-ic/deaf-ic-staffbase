-- 031: 通勤手段・区間詳細カラム追加
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS commute_method text,
  ADD COLUMN IF NOT EXISTS commute_time_minutes int,
  ADD COLUMN IF NOT EXISTS route_section1_route text,
  ADD COLUMN IF NOT EXISTS route_section1_transport text,
  ADD COLUMN IF NOT EXISTS route_section1_cost int,
  ADD COLUMN IF NOT EXISTS route_section2_route text,
  ADD COLUMN IF NOT EXISTS route_section2_transport text,
  ADD COLUMN IF NOT EXISTS route_section2_cost int,
  ADD COLUMN IF NOT EXISTS commute_route_detail text;
