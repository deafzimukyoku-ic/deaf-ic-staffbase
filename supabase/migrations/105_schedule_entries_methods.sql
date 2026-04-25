-- 105_schedule_entries_methods.sql
-- shift-puzzle 利用予定の忠実移植に必要な追加カラム
-- - pickup_method / dropoff_method: 'self'（自力来所/帰宅）or 'pickup'/'dropoff'（送迎要）
-- - note: 「追・休」「定・休」等の特殊表示用
-- - attendance_status に 'leave'（お休み = absent と挙動同じだが別ステータス保存）を追加

alter table public.schedule_entries
  add column if not exists pickup_method text not null default 'pickup'
    check (pickup_method in ('self', 'pickup')),
  add column if not exists dropoff_method text not null default 'dropoff'
    check (dropoff_method in ('self', 'dropoff')),
  add column if not exists note text;

comment on column public.schedule_entries.pickup_method is 'self=自分で来る、pickup=お迎え（送迎担当を割り当て）';
comment on column public.schedule_entries.dropoff_method is 'self=自分で帰る、dropoff=送り（送迎担当を割り当て）';
comment on column public.schedule_entries.note is '「追・休」「定・休」等の特殊表示テキスト';

-- attendance_status に 'leave' を追加（既存制約を作り直し）
alter table public.schedule_entries drop constraint if exists schedule_entries_attendance_status_check;
alter table public.schedule_entries
  add constraint schedule_entries_attendance_status_check
  check (attendance_status in ('planned','present','absent','late','early_leave','leave'));
