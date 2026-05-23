-- migration 200: push_subscriptions テーブル + RLS
--
-- Why: PWA Web Push 用の subscription を社員ごと/端末ごとに保存する。
--   1 社員が PC + iPhone + Android の 3 端末で許可した場合、3 行 insert される。
--   配信側は service role で全件 SELECT し web-push でブロードキャスト。
--   410 Gone (期限切れ) を受けたら last_failed_at をマーク + 行削除して再 subscribe を促す。
--
-- 既存テーブル: notification_queue (メール用キュー) と並行運用。Push 用の独立キューは持たない
--   (cron 経由で digest メール送信時に同タイミングで push を出す)。
--
-- 公開範囲: 本人のみ SELECT/INSERT/DELETE。manager/admin が他社員の subscription を見られる
--   ユースケースは無い (= 自分の端末管理用)。配信は service role でバイパス。

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_failed_at timestamptz
);

create index if not exists idx_push_subscriptions_employee on public.push_subscriptions(employee_id);

alter table public.push_subscriptions enable row level security;

-- 本人 SELECT
drop policy if exists push_sub_self_select on public.push_subscriptions;
create policy push_sub_self_select on public.push_subscriptions
  for select
  using (employee_id in (select id from public.employees where auth_user_id = auth.uid()));

-- 本人 INSERT
drop policy if exists push_sub_self_insert on public.push_subscriptions;
create policy push_sub_self_insert on public.push_subscriptions
  for insert
  with check (employee_id in (select id from public.employees where auth_user_id = auth.uid()));

-- 本人 UPDATE (last_used_at / last_failed_at の自更新用。原則 API 経由)
drop policy if exists push_sub_self_update on public.push_subscriptions;
create policy push_sub_self_update on public.push_subscriptions
  for update
  using (employee_id in (select id from public.employees where auth_user_id = auth.uid()))
  with check (employee_id in (select id from public.employees where auth_user_id = auth.uid()));

-- 本人 DELETE (オフ操作用)
drop policy if exists push_sub_self_delete on public.push_subscriptions;
create policy push_sub_self_delete on public.push_subscriptions
  for delete
  using (employee_id in (select id from public.employees where auth_user_id = auth.uid()));

notify pgrst, 'reload schema';
