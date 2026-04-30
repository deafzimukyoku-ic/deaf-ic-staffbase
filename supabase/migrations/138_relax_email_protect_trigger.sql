-- 138_relax_email_protect_trigger.sql
-- migration 132 で追加した employees.email 保護トリガを削除する。
--
-- 経緯:
--   migration 132 のトリガは current_setting('request.jwt.claim.role', true) で
--   service_role を判定していたが、Supabase / PostgREST の組合せによっては
--   この値が期待通り 'service_role' を返さず、専用 API (/api/employees/[id]/email)
--   経由の正規パスでもブロックされてしまう問題が発生した。
--   結果、auth.users の email 更新は成功したが employees の更新が失敗し、
--   両者が乖離する状態が起きた。
--
-- 対策:
--   トリガによる保護は撤回し、アプリ層の保護のみに統一する。
--   - admin UI: email は基本情報 draft から除外済み (app/(admin)/admin/employees/[id]/page.tsx)
--   - email 変更は専用 API 経由のみ (auth.users と employees の両方を service_role で同期更新)
--   - RLS は引き続き「他テナント・他社員の email 編集」を防止
--
--   DB 層での重ね掛け保護を諦める代わりに、運用・テスト容易性を取り戻す。

drop trigger if exists employees_protect_email_update on public.employees;
drop function if exists public.protect_employees_email_update();

-- 既存の乖離データを修復（万一発生していた場合）
update public.employees e
   set email = u.email
  from auth.users u
 where e.auth_user_id = u.id
   and e.email is distinct from u.email;
