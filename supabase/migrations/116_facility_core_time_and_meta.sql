-- 116_facility_core_time_and_facility_meta.sql
--
-- A. facility_shift_settings に「コアタイム（提供時間）」の開始/終了を追加。
--    これまで lib/logic/qualifiedCoverage.ts に hard-code されていた 10:30〜16:30 を
--    事業所ごとに設定できるようにする（午前型・午後型・夕方型などで運用が異なるため）。
--
-- B. facilities に display_order / shift_enabled / transport_enabled を追加。
--    - display_order: 並び順（事業所設定でドラッグ&ドロップ可能に）
--    - shift_enabled: OFF にするとシフトモードで事業所候補から非表示（本部など）
--    - transport_enabled: OFF にすると送迎ナビ・送迎関連 UI を非表示
--    既存施設は display_order=0,1,2... を created_at 順で割当て、enabled は両方 true デフォルト。

-- ============================================================
-- A. facility_shift_settings: コアタイム
-- ============================================================

alter table public.facility_shift_settings
  add column if not exists core_start_time time without time zone not null default '10:30',
  add column if not exists core_end_time   time without time zone not null default '16:30';

comment on column public.facility_shift_settings.core_start_time is
  'コアタイム開始 (HH:MM)。提供時間の有資格者カバレッジ判定の起点';
comment on column public.facility_shift_settings.core_end_time is
  'コアタイム終了 (HH:MM)。提供時間の有資格者カバレッジ判定の終点';

-- ============================================================
-- B. facilities: 並び順 + ON/OFF
-- ============================================================

alter table public.facilities
  add column if not exists display_order      integer not null default 0,
  add column if not exists shift_enabled      boolean not null default true,
  add column if not exists transport_enabled  boolean not null default true;

comment on column public.facilities.display_order is
  '並び順（小さいほど上）。事業所設定でドラッグ&ドロップで変更';
comment on column public.facilities.shift_enabled is
  'シフトモードで対象にするか。false なら事業所セレクタ・ナビから非表示（例: 本部）';
comment on column public.facilities.transport_enabled is
  '送迎機能を使うか。false なら送迎表ナビ・送迎関連 UI 非表示';

-- 既存施設の display_order を created_at 順で 0,1,2,... に backfill
do $$
declare
  r record;
  i integer := 0;
  prev_tenant uuid := null;
begin
  for r in
    select id, tenant_id
      from public.facilities
     order by tenant_id, created_at
  loop
    if prev_tenant is null or r.tenant_id <> prev_tenant then
      i := 0;
      prev_tenant := r.tenant_id;
    end if;
    update public.facilities set display_order = i where id = r.id;
    i := i + 1;
  end loop;
end$$;
