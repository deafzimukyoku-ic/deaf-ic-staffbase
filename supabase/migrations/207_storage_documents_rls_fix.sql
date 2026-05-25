-- 207: storage.objects の documents バケット policy を実 path 構造に合わせて修正
--
-- 真因 (2026-05-25 調査):
--   migration 118 が定義した「authenticated 全員 manage 可」policy は本番には適用されておらず、
--   別途 Supabase Dashboard で手動設定された厳格 policy が効いていた:
--     - "documents: admin can manage" [ALL]  role='admin' 限定 + folder[1]=tenant_id 期待
--     - "documents: tenant members can read" [SELECT]  folder[1]=tenant_id 期待
--   しかし BlockEditor / mgr-manuals が使う buildStoragePath は
--     <prefix>/<tenant_id>/<file>  (例: manuals/<uuid>/123_xyz_image.jpg)
--   を生成するため、folder[1] は常に prefix ('manuals'/'announcements'/...) になり tenant_id と
--   不一致 → admin であっても storage への INSERT が「new row violates row-level security policy」
--   で全件拒否されていた。
--
--   追加で manager は role 文字列レベルで弾かれており、今日まで manager が BlockEditor
--   を使い始めて発覚した形。
--
--   さらに過去アップ済の 9 件は全て API route (service role) 経由の
--   <tenant_id>/<file>.pdf 形式で、これは folder[1]=tenant_id が一致するので動いていた。
--
-- 修正方針:
--   storage policy 側を path 形式と manager 許可に合わせる。
--   - 読み: 同 tenant の認証ユーザ全員。レガシー (folder[1]=tenant) と新形式 (folder[2]=tenant) 両対応
--   - 書き: admin / manager で同 tenant。両 path 形式対応
--   - クライアント側 (BlockEditor / buildStoragePath / mgr-manuals) は一切変えない
--
-- 影響:
--   - admin/manager による画像 (announcements / compliance / trainings / manuals) アップロード復活
--   - mgr/manuals の PDF 添付機能復活
--   - 既存 <tenant>/<file>.pdf 形式 (API route 経由 PDF テンプレート 9 件) も引き続き読める
--   - employee は read のみ可 (write 不要)

drop policy if exists "documents: admin can manage" on storage.objects;
drop policy if exists "documents: tenant members can read" on storage.objects;
drop policy if exists "documents: authenticated can manage" on storage.objects;
drop policy if exists "documents: admin or manager can manage" on storage.objects;

-- 読み: 同テナントの認証ユーザ全員 (employee 含む)
create policy "documents: tenant members can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    AND (
      (storage.foldername(name))[1] = (
        select tenant_id::text from public.employees where auth_user_id = auth.uid() limit 1
      )
      OR (storage.foldername(name))[2] = (
        select tenant_id::text from public.employees where auth_user_id = auth.uid() limit 1
      )
    )
  );

-- 書き: admin / manager で同テナントのみ
-- audience (facility 単位) チェックはテーブル本体 RLS に任せる (二重チェックは過剰)
create policy "documents: admin or manager can manage" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documents'
    AND (
      (storage.foldername(name))[1] = (
        select tenant_id::text from public.employees where auth_user_id = auth.uid() limit 1
      )
      OR (storage.foldername(name))[2] = (
        select tenant_id::text from public.employees where auth_user_id = auth.uid() limit 1
      )
    )
    AND (
      select role from public.employees where auth_user_id = auth.uid() limit 1
    ) IN ('admin','manager')
  )
  with check (
    bucket_id = 'documents'
    AND (
      (storage.foldername(name))[1] = (
        select tenant_id::text from public.employees where auth_user_id = auth.uid() limit 1
      )
      OR (storage.foldername(name))[2] = (
        select tenant_id::text from public.employees where auth_user_id = auth.uid() limit 1
      )
    )
    AND (
      select role from public.employees where auth_user_id = auth.uid() limit 1
    ) IN ('admin','manager')
  );

-- PostgREST スキーマキャッシュ reload (DDL ではないが念のため)
notify pgrst, 'reload schema';
