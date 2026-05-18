-- 177: message_thread_members INSERT を自テナント所属者に開放
--
-- 176 で message_threads_insert を全ロール開放したが、後段の thread_members_insert
-- が「admin/manager OR 既存 member」ロジックで、新規スレッド作成の transaction で
-- 自分+受信者を member に追加する瞬間にまだ member でないため弾かれていた
-- (エラーメッセージは "new row violates row-level security policy for table
--  message_threads" と表示されることがあって紛らわしいが、実体は members 側)。
--
-- 修正: 自テナント所属者であれば、自テナント内のスレッドに member を追加可能。
-- スレッド作成者が最初の transaction で自分+受信者を入れる、既存 member が
-- 後から追加する、どちらも許可される。

DROP POLICY IF EXISTS thread_members_insert ON public.message_thread_members;

CREATE POLICY thread_members_insert ON public.message_thread_members FOR INSERT
WITH CHECK (
  /* 既に member ならそのスレッドの member 追加 OK (従来挙動を維持) */
  is_message_thread_member(thread_id)
  /* スレッドが自テナント所属なら、誰でも member 追加可能 (新規スレッド作成直後の
     初期 member 投入を許可するため) */
  OR EXISTS (
    SELECT 1
    FROM public.message_threads t,
         public.employees e
    WHERE t.id = thread_id
      AND e.auth_user_id = auth.uid()
      AND t.tenant_id = e.tenant_id
  )
);

NOTIFY pgrst, 'reload schema';
