-- 118_documents_storage_bucket.sql
-- documents / employee-images バケットを作成。
-- これまで Supabase Dashboard で手動作成が必要だった。環境再構築時の事故を防ぐため SQL 化。
--
-- 実装側の前提:
--   - PDF テンプレートのアップロードは /api/documents/upload-pdf 経由（Service Role で RLS バイパス）
--   - 社員画像は /api/employees/upload-image 経由（同上）
--   - BlockEditor はクライアント認証で直接 upload するので、authenticated に対して
--     書き込み許可ポリシーが必要（同テナント配下のみ）

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-images',
  'employee-images',
  true,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- 既存ポリシーを drop（再実行時の冪等のため）
-- ============================================================
drop policy if exists "documents: authenticated can manage" on storage.objects;
drop policy if exists "documents: authenticated can read" on storage.objects;
drop policy if exists "documents: admin can manage" on storage.objects;
drop policy if exists "documents: tenant members can read" on storage.objects;
drop policy if exists "employee-images: authenticated can manage" on storage.objects;
drop policy if exists "employee-images: tenant members can read" on storage.objects;
drop policy if exists "employee-images: admin can manage" on storage.objects;

-- ============================================================
-- documents: 認証済ユーザは CRUD 可。実際の権限制御は API 側 + DB 側 RLS で
-- ============================================================
create policy "documents: authenticated can manage" on storage.objects
  for all to authenticated
  using (bucket_id = 'documents')
  with check (bucket_id = 'documents');

-- ============================================================
-- employee-images: public バケットなので read は全認証ユーザ、書込は authenticated
-- ============================================================
create policy "employee-images: authenticated can manage" on storage.objects
  for all to authenticated
  using (bucket_id = 'employee-images')
  with check (bucket_id = 'employee-images');
