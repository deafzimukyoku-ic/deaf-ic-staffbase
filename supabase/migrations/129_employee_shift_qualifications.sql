-- 129_employee_shift_qualifications.sql
-- Phase 66+: 保有資格と「シフト用資格」を分離
--
-- 背景:
-- - employees.qualifications は元々「シフト・送迎の有資格者判定」用に
--   facility_shift_settings.qualification_types マスタと連動した text[] だった
-- - 一方プロフィールの「保有資格」は本来「個人が持っている資格（介護福祉士、英検 etc.）」を
--   自由入力したいユースケース。事業所マスタに紐付けるのは過剰
-- - そこで:
--    employees.qualifications          → 自由入力の保有資格（プロフィール表示用）
--    employees.shift_qualifications    → 事業所マスタ連動（is_qualified 判定 / シフト自動生成）

alter table public.employees
  add column if not exists shift_qualifications text[] not null default '{}'::text[];

-- 既存 qualifications を backfill（運用変えずに分離開始するため）
update public.employees
   set shift_qualifications = coalesce(qualifications, '{}'::text[])
 where (shift_qualifications is null or array_length(shift_qualifications, 1) is null)
   and qualifications is not null
   and array_length(qualifications, 1) is not null;

comment on column public.employees.qualifications is
  '保有資格（個人）。プロフィール表示用の自由入力 text[]。事業所マスタとは独立。';
comment on column public.employees.shift_qualifications is
  'シフト・送迎モードの資格。facility_shift_settings.qualification_types マスタから選択された名前の配列。is_qualified 判定や シフト自動生成のロジックで使用。';
