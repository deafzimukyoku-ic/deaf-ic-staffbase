-- 176: 個別連絡スレッドの新規作成を全 active 社員に開放
--
-- 旧 message_threads_insert (migration 142) は admin / manager のみ INSERT 可だったため、
-- employee や shift_manager が「+ 新規メッセージ」から送信しようとすると
-- "new row violates row-level security policy" で弾かれていた。
--
-- 個別連絡は本来双方向コミュニケーション (社員から管理者への質問など) のためのもの
-- なので、ロール制限を撤廃して「自テナント所属者なら誰でも新規スレッド作成可能」に。
-- ただし他テナントに作成は不可 (tenant_id の一致は維持)。
-- スレッド内のメッセージ送信は member 制で別途制御。

DROP POLICY IF EXISTS message_threads_insert ON public.message_threads;

CREATE POLICY message_threads_insert ON public.message_threads FOR INSERT
WITH CHECK (
  tenant_id = (
    SELECT tenant_id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1
  )
);

NOTIFY pgrst, 'reload schema';
