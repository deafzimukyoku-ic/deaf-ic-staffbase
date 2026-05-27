-- 213: videos バケット作成 + tenant 分離 RLS + active 判定
--
-- 機能仕様: docs/features/content-media-parity-with-diletto.md (2026-05-27 承認)
-- 関連: migration 210 (documents バケットの active-only RLS パターンをひな型)
--      migration 198 (diletto-new-staffbase 側の対応 migration、本 deaf-ic に移植)
--
-- 設計:
--   - 新規 videos バケット (private, file_size_limit 500 MB, mime: video/mp4 | webm | quicktime)
--   - SELECT: 同テナント + status='active' な employee 全員
--   - ALL: admin/manager + status='active' + 同テナントのみ書込可
--   - path 形式は buildStoragePath('videos', tenantId, filename) = videos/{tenant}/{ts_r_file}
--     したがって folder[2] = tenant_id でチェック (folder[1] は常に 'videos' 固定)
--   - レガシーパスは存在しない (新規バケット) ので folder[1] フォールバックは不要
--
-- 退職者対策の構造:
--   - status='retired' になった瞬間 RLS で 0 件ヒットに
--   - /api/storage/sign 側でも RPC can_access_media_path が active 判定して 403
--   - 二重ガードで覆う (migration 210/211 と同じ方針)
--
-- 影響:
--   - 新規動画アップロードは BlockEditor 経由で必ず folder[2] = tenant にハマる
--   - 既存 Drive 動画 13 本は scripts/migrate-drive-to-storage.mjs (service_role) で
--     videos バケットに upload + content_blocks 書き換え。service_role は RLS バイパスのため本 policy に依存しない
--
-- Rollback (緊急時):
--   begin;
--   drop policy "videos: tenant members can read" on storage.objects;
--   drop policy "videos: admin or manager can manage" on storage.objects;
--   delete from storage.buckets where id = 'videos';
--   notify pgrst, 'reload schema';
--   commit;
--   ※ rollback 時、videos/ 配下にアップロード済みファイルがあれば事前に手動削除が必要

-- バケット作成 (既に存在する場合は設定だけ更新)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 524288000, array['video/mp4','video/webm','video/quicktime'])
on conflict (id) do update
set file_size_limit = 524288000,
    allowed_mime_types = array['video/mp4','video/webm','video/quicktime'],
    public = false;

-- 旧 policy が同名で残っている場合は drop (再適用安全化)
drop policy if exists "videos: tenant members can read" on storage.objects;
drop policy if exists "videos: admin or manager can manage" on storage.objects;

-- 読み: 同テナント + active な employee 全員
create policy "videos: tenant members can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'videos'
    AND exists (
      select 1 from public.employees
       where auth_user_id = auth.uid()
         and status = 'active'
         and tenant_id::text = (storage.foldername(name))[2]
    )
  );

-- 書き: admin/manager + active + 同テナントのみ
create policy "videos: admin or manager can manage" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'videos'
    AND exists (
      select 1 from public.employees
       where auth_user_id = auth.uid()
         and status = 'active'
         and role in ('admin','manager')
         and tenant_id::text = (storage.foldername(name))[2]
    )
  )
  with check (
    bucket_id = 'videos'
    AND exists (
      select 1 from public.employees
       where auth_user_id = auth.uid()
         and status = 'active'
         and role in ('admin','manager')
         and tenant_id::text = (storage.foldername(name))[2]
    )
  );

notify pgrst, 'reload schema';
