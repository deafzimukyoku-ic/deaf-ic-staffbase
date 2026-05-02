-- 145: migration 144 のロールバック
--
-- migration 144 適用後に "社員情報が見つかりません" / 全員ログアウト発生のため
-- 一旦ポリシーを削除して元の挙動に戻す。
-- 部下管理が空問題は別途調査して再修正する。

DROP POLICY IF EXISTS "manager can read subordinate employees" ON public.employees;
