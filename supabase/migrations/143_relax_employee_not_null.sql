-- Phase G+: 管理者編集時に空欄保存できるよう、employees テーブルの NOT NULL 制約を緩和
--
-- 背景: 管理画面で社員情報を一部だけ更新したい場面（後で本人が埋める運用、退職予定者など）で
-- postal_code / address / phone / birth_date / join_date 等の NOT NULL 制約に
-- 引っかかって保存失敗するケースがあった。
--
-- 緩和対象（admin が編集する基本情報の中で「未設定でも運用上問題ない」もの）:
--   postal_code, address, phone, birth_date, join_date
--
-- 維持する NOT NULL（識別子として必須）:
--   employee_number, email, last_name, first_name, last_name_kana, first_name_kana,
--   role, status, has_car_commute, is_shuttle_driver, created_at, updated_at

ALTER TABLE public.employees ALTER COLUMN postal_code DROP NOT NULL;
ALTER TABLE public.employees ALTER COLUMN address     DROP NOT NULL;
ALTER TABLE public.employees ALTER COLUMN phone       DROP NOT NULL;
ALTER TABLE public.employees ALTER COLUMN birth_date  DROP NOT NULL;
ALTER TABLE public.employees ALTER COLUMN join_date   DROP NOT NULL;
