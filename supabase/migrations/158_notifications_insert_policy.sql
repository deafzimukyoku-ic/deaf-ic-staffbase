-- 158: notifications テーブルに INSERT ポリシーを追加
--
-- 背景:
-- migration 139 で notifications に RLS を有効化 + SELECT/UPDATE/DELETE のポリシーを定義したが、
-- INSERT ポリシーが抜けていた。RLS 有効 + INSERT ポリシー無し = 全 INSERT が拒否 → 403 エラー。
-- これにより以下のフローが本番で失敗していた:
--   - 個別連絡(message) 送信 → 受信者への通知 INSERT で 403
--   - シフト変更申請 → 該当 admin への通知
--   - お知らせ/遵守事項/研修/業務マニュアル の cron 送信 (service_role なので影響なし)
--
-- 追加するポリシー:
--   - 認証ユーザーは「自分が actor」かつ「自分と同じテナント」の通知を INSERT 可能
--   - actor_employee_id が自分の employees.id と一致することを WITH CHECK で強制

begin;

drop policy if exists notif_actor_insert on public.notifications;
create policy notif_actor_insert on public.notifications for insert
  with check (
    actor_employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
    and tenant_id = (select tenant_id from public.employees where auth_user_id = auth.uid() limit 1)
  );

commit;
