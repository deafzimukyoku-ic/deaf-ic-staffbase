-- 117_license_back_image.sql
-- 免許証の裏面画像も保存できるよう employees テーブルに license_image_back_path を追加。
-- 既存 license_image_path は表面用として継続使用。

alter table public.employees
  add column if not exists license_image_back_path text;

comment on column public.employees.license_image_back_path is
  '免許証 裏面のスクリーンショット (employee-images bucket 内のパス)';
