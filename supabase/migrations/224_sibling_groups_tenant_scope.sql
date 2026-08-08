-- 224_sibling_groups_tenant_scope.sql
-- 兄弟グループを法人全体スコープにし、請求担当事業所を持たせる（先方要望 2026-08-08）
--
-- 背景:
--   migration 223 では兄弟グループを事業所スコープにしたが、実運用では
--   兄弟が別々の事業所に通うケースがある（例: 兄=パズル / 妹=パレット）。
--   世帯は事業所をまたぐ概念なので、グループ自体は法人全体で 1 つにする。
--
-- 決定事項（ユーザー確認済み）:
--   - グループは**全事業所から選べる**（法人全体で一意）
--   - 「きょうだい合計」は**自事業所の児童のみ**を合計する。
--     他事業所の児童の金額は読まない = **事業所分離は緩めない**（料金表は事業所単位の帳票のまま）
--   - どの事業所が請求を出すかを `billing_facility_id` で決められる。
--     請求担当でない事業所には「請求は◯◯事業所」と表示して二重請求を防ぐ
--   - 差分表示は不要（料金表は保存値で固定せず常にライブ再計算しているため、
--     他事業所が編集しても開き直せば必ず最新になる）
--
-- 設計判断:
--   - `facility_id` 列は残す（CLAUDE.md §7「facility_id の無いテーブル作成禁止」）が、
--     意味は「作成元の事業所」に変わり、**アクセス制御には使わない**
--   - UNIQUE を (tenant_id, facility_id, label) → (tenant_id, label) に変更。
--     同じ世帯が事業所ごとに重複登録されるのを防ぐ
--   - RLS: manager / shift_manager にテナント全域の読み書きを許す。
--     このテーブルが持つのは**グループ名と請求担当事業所だけ**で、
--     児童名・金額は一切含まないため、事業所分離の実質的な緩和にはならない。
--     児童 (`children`) と請求 (`billing_*`) の RLS は**一切変更しない**
--
-- storage 非変更のため storage-policy snapshot 不要。

-- 既存行は 0 件（migration 223 適用後にまだ 1 件も作られていない）ため、
-- UNIQUE の張り替えで衝突は起きない。将来のために conflict 時は失敗させる（DO 句を使わない）。
alter table public.sibling_groups
  drop constraint if exists sibling_groups_tenant_id_facility_id_label_key;

alter table public.sibling_groups
  drop constraint if exists sibling_groups_tenant_id_label_key;
alter table public.sibling_groups
  add constraint sibling_groups_tenant_id_label_key unique (tenant_id, label);

-- 請求担当事業所。null = 未設定（各事業所が自分の分を請求する運用）
alter table public.sibling_groups
  add column if not exists billing_facility_id uuid null
    references public.facilities(id) on delete set null;

comment on column public.sibling_groups.facility_id is
  '作成元の事業所（記録用）。migration 224 以降アクセス制御には使わない。';
comment on column public.sibling_groups.billing_facility_id is
  'この世帯の請求を出す事業所。null=未設定（各事業所が自分の分を請求）。'
  ' 請求担当でない事業所の利用料金表には「請求は◯◯事業所」と表示して二重請求を防ぐ。migration 224';
comment on table public.sibling_groups is
  '兄弟グループ（法人全体で一意）。兄弟が別事業所に通うケースがあるためテナントスコープ。'
  ' 保持するのはグループ名と請求担当事業所のみで、児童名・金額は持たない。migration 223 / 224';

-- ============================================================
-- RLS: 事業所ではなくテナントでスコープする
-- ============================================================
drop policy if exists sg_manager_facility on public.sibling_groups;

drop policy if exists sg_manager_tenant on public.sibling_groups;
create policy sg_manager_tenant on public.sibling_groups for all
  using (
    get_my_role() = any (array['manager', 'shift_manager'])
    and tenant_id = get_my_tenant_id()
  );

-- admin 用 (sg_admin_all) は 223 のまま（テナント全域）。employee 用ポリシーは引き続き作らない。
