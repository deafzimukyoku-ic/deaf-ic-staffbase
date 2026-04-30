-- 130_employee_facilities.sql
-- Phase 67-A: 職員の複数事業所所属（兼任）対応
--
-- 背景: NPO 4 事業所運用で、複数事業所をいったり来たりする職員が現実に存在する。
-- 従来 employees.facility_id (uuid 単一) では1人を1事業所にしか紐付けられず、
-- 兼任先のお知らせ / 遵守事項 / 研修 / マニュアル / 休み希望管理 が届かない問題があった。
--
-- 設計:
--   - employees.facility_id は「主所属」として残置（給与・通勤手当・職員一覧の主表示・既存コード互換）
--   - 新規 employee_facilities テーブルに「兼任先 (additional only)」を持つ
--   - ヘルパー関数 get_my_facility_ids() = primary ∪ 兼任先（employee 側コンテンツフィルタ用）
--   - ヘルパー関数 get_my_managed_facility_ids() = primary ∪ manager_facilities（manager 管轄 RLS 用）
--     ※ 副次効果で既存の「manager_facilities が shift RLS に効いてなかった」も解消
--   - employee_belongs_to_facility(emp_id, fac_id): 任意職員×任意 facility の所属判定（UI/API ヘルパー）
--
-- ※ 兼任職員のシフト「他施設応援」マークは shift_assignments.assignment_type='external' で
--    別 migration (133) にて対応。本 migration はメンバーシップのみ。

-- ============================================================
-- 1. employee_facilities テーブル（兼任先のみ）
-- ============================================================

create table if not exists public.employee_facilities (
  employee_id uuid not null references public.employees(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, facility_id)
);

create index if not exists idx_employee_facilities_facility
  on public.employee_facilities(facility_id);

comment on table public.employee_facilities is
  'Phase 67-A: 職員の兼任先事業所。primary は employees.facility_id 側、本テーブルは additional only。閲覧/休み希望/シフト等は primary ∪ 兼任先 で判定。';

-- ============================================================
-- 2. ヘルパー関数
-- ============================================================

-- 自分の所属する全 facility_id（primary + 兼任先）
-- employee 側コンテンツフィルタ・自分の休み希望提出可能 facility 判定に使用
create or replace function get_my_facility_ids()
returns setof uuid as $$
  select facility_id from public.employees
   where auth_user_id = auth.uid() and facility_id is not null
  union
  select facility_id from public.employee_facilities
   where employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1);
$$ language sql security definer stable;

comment on function get_my_facility_ids() is
  '自分が所属する全 facility_id（主所属 + 兼任先）。employee 側 RLS / コンテンツフィルタで使用。';

-- 自分が管轄するマネージャー施設 ID（primary + manager_facilities）
-- manager 側 RLS で使用。employee_facilities (兼任) は管轄ではないので含めない。
create or replace function get_my_managed_facility_ids()
returns setof uuid as $$
  select facility_id from public.employees
   where auth_user_id = auth.uid() and facility_id is not null
  union
  select facility_id from public.manager_facilities
   where employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1);
$$ language sql security definer stable;

comment on function get_my_managed_facility_ids() is
  'マネージャーが管轄する全 facility_id（主所属 + manager_facilities）。manager 側 RLS で使用。';

-- 任意職員が任意 facility に所属するか（primary または兼任先）
-- 主にアプリコード / 他テーブルの行レベル制約で使用
create or replace function employee_belongs_to_facility(p_employee_id uuid, p_facility_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.employees
     where id = p_employee_id and facility_id = p_facility_id
  ) or exists (
    select 1 from public.employee_facilities
     where employee_id = p_employee_id and facility_id = p_facility_id
  );
$$ language sql security definer stable;

comment on function employee_belongs_to_facility(uuid, uuid) is
  '任意職員 × 任意 facility の所属判定（primary または兼任先）。';

-- ============================================================
-- 3. 整合性トリガ: 主所属 = 兼任先 の重複を弾く
--    employees.facility_id が変更されたとき、その facility_id が兼任先に存在すれば削除（主所属に昇格扱い）
-- ============================================================

create or replace function trg_employee_facilities_dedupe_primary()
returns trigger as $$
begin
  -- 主所属が設定/変更されたら、その facility_id の兼任先レコードを削除（重複排除）
  if NEW.facility_id is not null and (TG_OP = 'INSERT' or NEW.facility_id is distinct from OLD.facility_id) then
    delete from public.employee_facilities
     where employee_id = NEW.id and facility_id = NEW.facility_id;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists employees_dedupe_primary_facility on public.employees;
create trigger employees_dedupe_primary_facility
  after insert or update of facility_id on public.employees
  for each row execute function trg_employee_facilities_dedupe_primary();

-- 兼任先 INSERT 時、主所属と同じ facility なら弾く（NOTICE して無視）
create or replace function trg_employee_facilities_skip_primary_dup()
returns trigger as $$
declare
  v_primary uuid;
begin
  select facility_id into v_primary from public.employees where id = NEW.employee_id;
  if v_primary is not null and v_primary = NEW.facility_id then
    -- primary と同じ facility は兼任先にしない（黙って skip）
    return null;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists ef_skip_primary_dup on public.employee_facilities;
create trigger ef_skip_primary_dup
  before insert on public.employee_facilities
  for each row execute function trg_employee_facilities_skip_primary_dup();

-- ============================================================
-- 4. RLS（manager_facilities と同形）
-- ============================================================

alter table public.employee_facilities enable row level security;

-- 全テナントメンバーは自テナント内の所属関係を読める（職員一覧・シフト編集 UI で表示するため）
drop policy if exists ef_tenant_read on public.employee_facilities;
create policy ef_tenant_read on public.employee_facilities for select
  using (
    employee_id in (
      select id from public.employees where tenant_id = get_my_tenant_id()
    )
  );

-- admin は自テナント内の兼任先を CRUD 全権
drop policy if exists ef_admin_all on public.employee_facilities;
create policy ef_admin_all on public.employee_facilities for all
  using (
    get_my_role() = 'admin'
    and employee_id in (
      select id from public.employees where tenant_id = get_my_tenant_id()
    )
  );

-- manager は自分が管轄する facility への兼任先 INSERT/DELETE のみ可
-- （他施設の職員に対して、自施設への兼任登録ができる ＝「うち兼任で来る」を申請できる）
drop policy if exists ef_manager_manage on public.employee_facilities;
create policy ef_manager_manage on public.employee_facilities for all
  using (
    get_my_role() = 'manager'
    and facility_id in (select get_my_managed_facility_ids())
    and employee_id in (
      select id from public.employees where tenant_id = get_my_tenant_id()
    )
  );

-- ============================================================
-- 5. 既存データのバックフィル（不要 — primary は employees.facility_id にそのまま残る）
--    本 migration は「兼任先」のみを扱うため、何も INSERT しない。
-- ============================================================
