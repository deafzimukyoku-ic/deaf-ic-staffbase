-- 新規登録時にテナントとemployeeの作成を許可するRLSポリシー
-- 認証済みユーザーであれば誰でもテナントを作成可能（登録フロー用）
CREATE POLICY "authenticated can insert tenant" ON tenants
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 認証済みユーザーが自分自身のemployeeレコードを作成可能（登録フロー用）
CREATE POLICY "authenticated can insert own employee" ON employees
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());
