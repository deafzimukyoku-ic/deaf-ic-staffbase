-- 172: 送迎表の列順を施設単位で共有するため facility_shift_settings に jsonb 追加
--
-- 背景:
-- 送迎表 (components/shift/TransportFull.tsx) の列順
-- (迎時間/迎場所/迎担当/送時間/送場所/送担当) は localStorage に保存していたため、
-- ブラウザ/デバイス単位で並びがバラバラだった。
-- 「施設で並びを統一したい」という運用要望に対応するため、施設単位の DB カラムに移行。
--
-- 仕様:
-- - NULL 許容 (NOT NULL にしない)。フロント側は NULL なら
--   DEFAULT_TRANSPORT_COLUMN_ORDER (lib/constants.ts) でフォールバック
-- - jsonb で TransportColumnKey の配列を直接格納
--   例: ["pickup_time","pickup_area","pickup_staff","dropoff_time","dropoff_area","dropoff_staff"]
-- - RLS は既存 facility_shift_settings の fss_select / fss_admin_all / fss_manager_own
--   (103 / 131) を流用。admin / manager のみ UPDATE 可
-- - index 追加不要 (1 施設 1 行のテーブルのため)

ALTER TABLE public.facility_shift_settings
  ADD COLUMN IF NOT EXISTS transport_column_order jsonb;

COMMENT ON COLUMN public.facility_shift_settings.transport_column_order IS
  '送迎表の列順 (迎時間/迎場所/迎担当/送時間/送場所/送担当)。'
  '施設単位で全員に共通の並びを共有。NULL なら DEFAULT_TRANSPORT_COLUMN_ORDER にフォールバック。';

NOTIFY pgrst, 'reload schema';
