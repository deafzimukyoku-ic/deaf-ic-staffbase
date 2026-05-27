-- 210: documents バケットの storage.objects RLS に status='active' 条件を追加
--
-- 背景 (2026-05-26):
--   退職者 (employees.status='retired') が退職前にメモした URL を使って退職後も
--   コンテンツメディア (動画/PDF/画像) にアクセスできてしまう構造問題が判明。
--   docs/features/content-media-signed-url.md (Phase 1) で構造修正。
--
-- 修正方針:
--   207 の RLS 構造 (path 2 形式対応 + admin/manager 書込可) を維持し、
--   全 SELECT/ALL policy に `status='active'` 条件を AND で追加する。
--   retired のユーザーは Supabase クライアント経由でも 0 件ヒットになる。
--   さらに `request_signed_media_url` API (migration 211) で 2 重ガードを設ける。

drop policy if exists "documents: admin or manager can manage" on storage.objects;
drop policy if exists "documents: tenant members can read" on storage.objects;

-- 読み: 同テナント + active な employee のみ
create policy "documents: tenant members can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    AND exists (
      select 1 from public.employees
       where auth_user_id = auth.uid()
         and status = 'active'
         and (
           tenant_id::text = (storage.foldername(name))[1]
           OR tenant_id::text = (storage.foldername(name))[2]
         )
    )
  );

-- 書き: admin/manager + active + 同テナント
create policy "documents: admin or manager can manage" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    AND exists (
      select 1 from public.employees
       where auth_user_id = auth.uid()
         and status = 'active'
         and role in ('admin','manager')
         and (
           tenant_id::text = (storage.foldername(name))[1]
           OR tenant_id::text = (storage.foldername(name))[2]
         )
    )
  )
  with check (
    bucket_id = 'documents'
    AND exists (
      select 1 from public.employees
       where auth_user_id = auth.uid()
         and status = 'active'
         and role in ('admin','manager')
         and (
           tenant_id::text = (storage.foldername(name))[1]
           OR tenant_id::text = (storage.foldername(name))[2]
         )
    )
  );

notify pgrst, 'reload schema';
