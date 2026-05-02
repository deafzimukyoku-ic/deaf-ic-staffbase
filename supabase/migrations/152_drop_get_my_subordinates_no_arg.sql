-- 152: get_my_subordinates の no-arg オーバーロードを削除
--
-- 問題:
-- migration 148 で get_my_subordinates(p_facility_id uuid DEFAULT NULL) を
-- 追加したが、147 で作成済みの no-arg 版 get_my_subordinates() を DROP しなかった。
-- PostgreSQL では関数シグネチャが異なれば別関数として共存するため、
-- 両方が DB に残っていた。
--
-- 結果:
-- - PostgREST のスキーマキャッシュ更新後、両オーバーロードを認識し
--   `supabase.rpc('get_my_subordinates', { p_facility_id: <uuid> })` の
--   引数解決で 400 を返すようになった。
-- - /mgr/subordinates 一覧が「マネージャーから見れない」状態に。
--
-- 修正:
-- - no-arg 版を DROP し、1-arg 版だけ残す。
-- - 1-arg 版は p_facility_id に DEFAULT NULL があるので、
--   引数なし呼び出しでも動作する（148 の挙動を維持）。

DROP FUNCTION IF EXISTS public.get_my_subordinates();

NOTIFY pgrst, 'reload schema';
