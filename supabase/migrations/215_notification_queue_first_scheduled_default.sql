-- 215: notification_queue.first_scheduled_at に DEFAULT now() を付与（再発防止ガード）
--
-- 背景（真因）:
--   migration 180 で first_scheduled_at を NOT NULL 化したが、INSERT 時に値を
--   明示設定する責任を各 enqueue 経路に委ねていた。
--   - app/api/notifications/enqueue/route.ts → first_scheduled_at を設定（OK）
--   - app/api/shifts/transition/route.ts     → 設定し忘れ（NG）
--   後者の enqueue INSERT が NOT NULL 違反で失敗し、しかも呼び出し側 catch で
--   握り潰されていたため「シフトを公開できるのに ready/公開通知が一切送られない」
--   状態が 180 適用(2026-05-18)〜2026-05-31 の間 継続していた（deaf-ic / diletto 両方）。
--
-- 対策（構造的な再発防止）:
--   列に DEFAULT now() を付与し、将来どの enqueue 経路が値を omit しても
--   INSERT が落ちないようにする。アプリ側でも明示設定する 2 段構え。
--   既存データ・NOT NULL 制約・rolling window ロジックは変更しない
--   （enqueue 側は引き続き first_scheduled_at を上書きせず起点として保持する）。
ALTER TABLE public.notification_queue
  ALTER COLUMN first_scheduled_at SET DEFAULT now();

NOTIFY pgrst, 'reload schema';
