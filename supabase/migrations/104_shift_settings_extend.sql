-- 104_shift_settings_extend.sql
-- ShiftPuzzle の完全移植に必要なフィールドを追加
-- Phase 4 Step 1.5: 事業所設定 + 職員管理で使用

-- facility_shift_settings: テナント共通設定を facility 単位で持てるよう拡張
alter table public.facility_shift_settings
  add column if not exists qualification_types jsonb not null default '[]'::jsonb,
  add column if not exists request_deadline_day integer not null default 20,
  add column if not exists transport_min_end_time time not null default '15:00:00',
  add column if not exists transport_pickup_cooldown_minutes integer not null default 30;

comment on column public.facility_shift_settings.qualification_types is
  '資格リスト: [{name: string, countable: boolean}]。countable=true のみ有資格者最低人数にカウント';
comment on column public.facility_shift_settings.request_deadline_day is
  '休み希望の提出締切日（毎月N日）';
comment on column public.facility_shift_settings.transport_min_end_time is
  '送迎担当の最低退勤時刻（これ以降退勤する職員のみ送迎候補）';
comment on column public.facility_shift_settings.transport_pickup_cooldown_minutes is
  '迎担当のクールダウン分数（同じ職員を連続で迎に割り当てない間隔）';

-- employees: 資格名リスト（qualification_types から選んだもの）
alter table public.employees
  add column if not exists qualifications text[] not null default '{}'::text[];

comment on column public.employees.qualifications is
  'facility_shift_settings.qualification_types から選ばれた名前の配列';
