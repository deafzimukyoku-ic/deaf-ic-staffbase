-- 212: documents バケットの file_size_limit を 20 MB → 200 MB に引き上げ
--
-- 背景:
--   研修・マニュアル動画 (mp4) を Drive から Supabase Storage に全件移行する
--   (docs/features/content-media-signed-url.md Phase 3)。
--   Phase 0 調査 (2026-05-26) で最大ファイルは 117.9 MB の PDF と 113.1 MB の動画。
--   200 MB に設定すれば全件カバー可能。Pro 100GB 枠に対する充足率 1% 未満。

update storage.buckets
   set file_size_limit = 200 * 1024 * 1024  -- 200 MB
 where id = 'documents';

notify pgrst, 'reload schema';
