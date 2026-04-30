-- 139_completion_notifications.sql
-- Phase 69: 完了通知システム
--
-- 5 種類の「完了アクション」が起きたとき、admin / 該当 manager に通知行を作成する。
--
-- 通知発生イベント:
--   1. document_submissions.status が 'submitted' になった時
--   2. compliance_acknowledgments INSERT 時
--   3. training_submissions INSERT 時 (合格判定とは無関係に提出時で通知)
--   4. announcement_reads INSERT 時
--   5. manual_reads INSERT 時
--
-- 受信者:
--   - admin: 全社員のアクション
--   - manager: 自管轄施設 (主所属 ∪ manager_facilities) に所属する社員のアクション
--   - 既存の get_my_managed_facility_ids() / employee_facilities ロジックを活用
--
-- UI:
--   - 画面右上に 🔔 ベル + 未読件数バッジ
--   - admin/manager dashboard 初回表示で未読あれば大きなモーダル自動表示
--   - 「既読にする」「全部既読」「閉じる」

-- ============================================================
-- 1. notifications テーブル
-- ============================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  /* 通知の受信者（admin / manager） */
  recipient_employee_id uuid not null references public.employees(id) on delete cascade,
  /* アクションを実行した社員 */
  actor_employee_id uuid references public.employees(id) on delete set null,
  /* デノーマライズ: 表示用に actor の情報を保存（社員退職等で参照不能でも通知が壊れないように） */
  actor_name text,
  actor_facility_name text,
  /* 通知種別 */
  event_type text not null check (event_type in (
    'document_submission',
    'compliance_ack',
    'training_submission',
    'announcement_read',
    'manual_read'
  )),
  /* イベント対象（書類テンプレ / 遵守事項 / 研修 / お知らせ / マニュアル の id） */
  event_target_id uuid,
  /* デノーマライズ: 表示用にタイトル */
  event_target_title text,
  /* 既読時刻（NULL = 未読） */
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_unread
  on public.notifications(recipient_employee_id, read_at, created_at desc);
create index if not exists idx_notifications_tenant
  on public.notifications(tenant_id);

comment on table public.notifications is
  'Phase 69: 完了通知。5 種のアクション (書類提出/遵守事項確認/研修提出/お知らせ既読/マニュアル既読) で自動 INSERT。';

alter table public.notifications enable row level security;

-- 受信者本人のみ自分の通知を読み書き可
drop policy if exists notif_self_select on public.notifications;
create policy notif_self_select on public.notifications for select
  using (recipient_employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1));

drop policy if exists notif_self_update on public.notifications;
create policy notif_self_update on public.notifications for update
  using (recipient_employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1))
  with check (recipient_employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1));

-- INSERT は trigger 内（SECURITY DEFINER）からのみ。直接 INSERT は不可。
-- DELETE は admin のみ（古い通知の整理用）
drop policy if exists notif_admin_delete on public.notifications;
create policy notif_admin_delete on public.notifications for delete
  using (
    tenant_id = (select tenant_id from public.employees where auth_user_id = auth.uid() limit 1)
    and (select role from public.employees where auth_user_id = auth.uid() limit 1) = 'admin'
  );

-- ============================================================
-- 2. ヘルパー関数: 受信者集合への一括 INSERT
--    actor の所属する facility (主所属 + 兼任先) を管轄する admin / manager に対して通知行を作成
-- ============================================================

create or replace function public.insert_completion_notifications(
  p_tenant_id uuid,
  p_actor_employee_id uuid,
  p_event_type text,
  p_event_target_id uuid,
  p_event_target_title text
) returns void as $$
declare
  v_actor_name text;
  v_actor_facility_name text;
begin
  -- actor 情報をデノーマライズ
  select
    coalesce(e.last_name, '') || ' ' || coalesce(e.first_name, ''),
    f.name
  into v_actor_name, v_actor_facility_name
  from public.employees e
  left join public.facilities f on f.id = e.facility_id
  where e.id = p_actor_employee_id;

  -- 受信対象: admin 全員 + 該当 facility を管轄する manager
  insert into public.notifications (
    tenant_id, recipient_employee_id, actor_employee_id,
    actor_name, actor_facility_name,
    event_type, event_target_id, event_target_title
  )
  select
    p_tenant_id, e.id, p_actor_employee_id,
    btrim(v_actor_name), v_actor_facility_name,
    p_event_type, p_event_target_id, p_event_target_title
  from public.employees e
  where e.tenant_id = p_tenant_id
    and e.status = 'active'
    and e.id <> p_actor_employee_id  /* 自分自身には通知しない */
    and (
      e.role = 'admin'
      or (
        e.role = 'manager'
        and (
          /* manager の主所属が actor の所属 facility のいずれかに一致 */
          e.facility_id in (
            select facility_id from public.employees
              where id = p_actor_employee_id and facility_id is not null
            union
            select facility_id from public.employee_facilities where employee_id = p_actor_employee_id
          )
          or
          /* manager_facilities 経由で管轄している */
          exists (
            select 1 from public.manager_facilities mf
            where mf.employee_id = e.id
              and mf.facility_id in (
                select facility_id from public.employees
                  where id = p_actor_employee_id and facility_id is not null
                union
                select facility_id from public.employee_facilities where employee_id = p_actor_employee_id
              )
          )
        )
      )
    );
end;
$$ language plpgsql security definer;

comment on function public.insert_completion_notifications(uuid, uuid, text, uuid, text) is
  'Phase 69: 通知行を受信者集合 (admin + 該当 manager) に一括 INSERT する内部ヘルパー。';

-- ============================================================
-- 3. トリガ #1: document_submissions.status='submitted' になった時
-- ============================================================

create or replace function public.trg_notify_document_submission()
returns trigger as $$
declare
  v_template_name text;
  v_tenant_id uuid;
begin
  -- INSERT 時: 直接 status='submitted' で作成された場合
  -- UPDATE 時: status が 'submitted' に変わった場合のみ
  if TG_OP = 'UPDATE' and (OLD.status = NEW.status or NEW.status <> 'submitted') then
    return NEW;
  end if;
  if TG_OP = 'INSERT' and NEW.status <> 'submitted' then
    return NEW;
  end if;

  select t.name, t.tenant_id into v_template_name, v_tenant_id
  from public.document_templates t
  where t.id = NEW.document_template_id;

  if v_tenant_id is null then return NEW; end if;

  perform public.insert_completion_notifications(
    v_tenant_id,
    NEW.employee_id,
    'document_submission',
    NEW.document_template_id,
    v_template_name
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists notify_document_submission on public.document_submissions;
create trigger notify_document_submission
  after insert or update of status on public.document_submissions
  for each row execute function public.trg_notify_document_submission();

-- ============================================================
-- 4. トリガ #2: compliance_acknowledgments INSERT 時
-- ============================================================

create or replace function public.trg_notify_compliance_ack()
returns trigger as $$
declare
  v_title text;
  v_tenant_id uuid;
begin
  select c.title, c.tenant_id into v_title, v_tenant_id
  from public.compliance_documents c
  where c.id = NEW.compliance_document_id;

  if v_tenant_id is null then return NEW; end if;

  perform public.insert_completion_notifications(
    v_tenant_id,
    NEW.employee_id,
    'compliance_ack',
    NEW.compliance_document_id,
    v_title
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists notify_compliance_ack on public.compliance_acknowledgments;
create trigger notify_compliance_ack
  after insert on public.compliance_acknowledgments
  for each row execute function public.trg_notify_compliance_ack();

-- ============================================================
-- 5. トリガ #3: training_submissions INSERT 時 (合格判定とは無関係に提出時で通知)
-- ============================================================

create or replace function public.trg_notify_training_submission()
returns trigger as $$
declare
  v_title text;
  v_tenant_id uuid;
begin
  select t.title, t.tenant_id into v_title, v_tenant_id
  from public.trainings t
  where t.id = NEW.training_id;

  if v_tenant_id is null then return NEW; end if;

  perform public.insert_completion_notifications(
    v_tenant_id,
    NEW.employee_id,
    'training_submission',
    NEW.training_id,
    v_title
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists notify_training_submission on public.training_submissions;
create trigger notify_training_submission
  after insert on public.training_submissions
  for each row execute function public.trg_notify_training_submission();

-- ============================================================
-- 6. トリガ #4: announcement_reads INSERT 時
-- ============================================================

create or replace function public.trg_notify_announcement_read()
returns trigger as $$
declare
  v_title text;
  v_tenant_id uuid;
begin
  select a.title, a.tenant_id into v_title, v_tenant_id
  from public.announcements a
  where a.id = NEW.announcement_id;

  if v_tenant_id is null then return NEW; end if;

  perform public.insert_completion_notifications(
    v_tenant_id,
    NEW.employee_id,
    'announcement_read',
    NEW.announcement_id,
    v_title
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists notify_announcement_read on public.announcement_reads;
create trigger notify_announcement_read
  after insert on public.announcement_reads
  for each row execute function public.trg_notify_announcement_read();

-- ============================================================
-- 7. トリガ #5: manual_reads INSERT 時
-- ============================================================

create or replace function public.trg_notify_manual_read()
returns trigger as $$
declare
  v_title text;
  v_tenant_id uuid;
begin
  select m.title, m.tenant_id into v_title, v_tenant_id
  from public.manuals m
  where m.id = NEW.manual_id;

  if v_tenant_id is null then return NEW; end if;

  perform public.insert_completion_notifications(
    v_tenant_id,
    NEW.employee_id,
    'manual_read',
    NEW.manual_id,
    v_title
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists notify_manual_read on public.manual_reads;
create trigger notify_manual_read
  after insert on public.manual_reads
  for each row execute function public.trg_notify_manual_read();
