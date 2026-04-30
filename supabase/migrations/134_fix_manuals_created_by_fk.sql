-- 134_fix_manuals_created_by_fk.sql
-- manuals.created_by の FK が ON DELETE 指定なし（= NO ACTION / RESTRICT）になっていたため、
-- 作成者の employees 行を削除しようとすると 23503 エラーで失敗していた。
--
-- 他のコンテンツテーブル (announcements / compliance_documents / trainings) は
-- migration 047 で ON DELETE SET NULL になっており、整合性のため manuals も同じに揃える。
--
-- 既存マニュアルの created_by はそのまま保持される（既存値が壊れているわけではない）。

alter table public.manuals drop constraint if exists manuals_created_by_fkey;
alter table public.manuals
  add constraint manuals_created_by_fkey
  foreign key (created_by)
  references public.employees(id)
  on delete set null;
