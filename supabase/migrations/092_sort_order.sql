-- 092_sort_order.sql
-- 遵守事項・研修・お知らせ・業務マニュアル の並び替え対応
-- sort_order 昇順で表示、新規は末尾（max+1）、ユーザーが手動で入替可能

alter table public.compliance_documents add column if not exists sort_order integer;
alter table public.trainings add column if not exists sort_order integer;
alter table public.announcements add column if not exists sort_order integer;
alter table public.manuals add column if not exists sort_order integer;

-- 既存行に tenant 内で created_at 昇順の連番を付与（古い順＝先頭）
update public.compliance_documents d
  set sort_order = sub.rn
  from (select id, row_number() over (partition by tenant_id order by created_at asc) as rn
        from public.compliance_documents) sub
  where d.id = sub.id and d.sort_order is null;

update public.trainings d
  set sort_order = sub.rn
  from (select id, row_number() over (partition by tenant_id order by created_at asc) as rn
        from public.trainings) sub
  where d.id = sub.id and d.sort_order is null;

update public.announcements d
  set sort_order = sub.rn
  from (select id, row_number() over (partition by tenant_id order by created_at asc) as rn
        from public.announcements) sub
  where d.id = sub.id and d.sort_order is null;

update public.manuals d
  set sort_order = sub.rn
  from (select id, row_number() over (partition by tenant_id order by created_at asc) as rn
        from public.manuals) sub
  where d.id = sub.id and d.sort_order is null;

-- インデックス（一覧表示の高速化）
create index if not exists idx_compliance_sort on public.compliance_documents(tenant_id, sort_order);
create index if not exists idx_trainings_sort on public.trainings(tenant_id, sort_order);
create index if not exists idx_announcements_sort on public.announcements(tenant_id, sort_order);
create index if not exists idx_manuals_sort on public.manuals(tenant_id, sort_order);
