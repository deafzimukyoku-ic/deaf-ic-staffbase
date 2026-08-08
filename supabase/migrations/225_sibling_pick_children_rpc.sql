-- 225_sibling_pick_children_rpc.sql
-- 兄弟の設定を「グループを作る」から「他の児童を選ぶ」に変える（先方要望 2026-08-08）
--
-- 背景:
--   migration 223/224 では職員に「兄弟グループ」を作らせていたが、
--   実際にやりたいのは「この子ときょうだいの子を結びつける」ことだけで、
--   グループ名を考える手間が余計だった。UI からグループの概念を消す。
--
-- 設計判断:
--   - `sibling_groups` テーブルは**内部表現として残す**。請求担当事業所
--     (`billing_facility_id`) は世帯単位の設定であり、置き場所が要るため。
--     ただし職員はグループを直接作らない/見ないので `label` を nullable にする
--     （UNIQUE (tenant_id, label) は残すが、Postgres は NULL の重複を許すので支障ない）。
--   - 兄弟の紐付けは **SECURITY DEFINER の RPC** で行う。
--     理由: 兄弟が別事業所に通う場合、A 事業所の職員が B 事業所の児童の
--     `sibling_group_id` を更新する必要があるが、children の RLS は自事業所のみ書き込み可。
--     ここで children の RLS を緩めると請求額まで見えてしまうため、
--     **触る列を `sibling_group_id` だけに限定した RPC** に閉じ込める（migration 214 と同じ方針）。
--   - 選択候補の一覧も RPC で返す。返すのは id / 氏名 / 事業所 / 現在の兄弟グループ**だけ**で、
--     住所・連絡先・上限額・請求額などは一切返さない。
--
-- RLS: children / billing 系のテーブルポリシーは**一切変更しない**（事業所分離は緩めない）。

-- ============================================================
-- 1) label を任意に（職員がグループ名を考えなくてよくする）
-- ============================================================
alter table public.sibling_groups alter column label drop not null;

comment on column public.sibling_groups.label is
  '世帯名（任意・表示用）。migration 225 以降 UI からは設定しない。null 可。'
  ' 料金表の表示はグループ名ではなく、同一グループの児童名から組み立てる。';

-- ============================================================
-- 2) 兄弟の選択候補（テナント全域・最小列のみ）
-- ============================================================
create or replace function public.get_sibling_candidates()
returns table (
  id uuid,
  name text,
  facility_id uuid,
  facility_name text,
  sibling_group_id uuid
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text;
  v_tenant uuid;
begin
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e
  where e.auth_user_id = auth.uid()
  limit 1;

  if v_tenant is null then return; end if;
  /* 兄弟の設定は請求担当者の作業。employee には開放しない */
  if v_role not in ('admin', 'manager', 'shift_manager') then return; end if;

  return query
  select c.id, c.name, c.facility_id, f.name, c.sibling_group_id
  from public.children c
  join public.facilities f on f.id = c.facility_id
  where c.tenant_id = v_tenant
    and c.is_active = true
  order by f.name, c.display_order nulls last, c.name;
end;
$$;

comment on function public.get_sibling_candidates() is
  '兄弟選択の候補一覧（テナント全域）。氏名・事業所・現在の兄弟グループのみを返し、'
  ' 住所/連絡先/上限額/請求額は返さない。admin / manager / shift_manager のみ。migration 225';

-- ============================================================
-- 3) 兄弟の紐付け（触るのは children.sibling_group_id だけ）
-- ============================================================
create or replace function public.set_child_siblings(p_child_id uuid, p_sibling_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tenant uuid;
  v_group uuid;
  v_all uuid[];
  v_old_group uuid;
  v_remaining integer;
  v_facility uuid;
begin
  select e.role, e.tenant_id into v_role, v_tenant
  from public.employees e
  where e.auth_user_id = auth.uid()
  limit 1;

  if v_tenant is null then raise exception '所属情報が取得できません'; end if;
  if v_role not in ('admin', 'manager', 'shift_manager') then
    raise exception '兄弟の設定を行う権限がありません';
  end if;

  /* 対象児童が自テナントであることを必ず確認する（他法人への書き込みを防ぐ） */
  select c.facility_id into v_facility
  from public.children c
  where c.id = p_child_id and c.tenant_id = v_tenant;
  if v_facility is null then raise exception '児童が見つかりません'; end if;

  v_all := array(
    select distinct x from unnest(array_append(coalesce(p_sibling_ids, '{}'::uuid[]), p_child_id)) x
    where x is not null
  );

  /* 指定された児童が全て自テナントか検証 */
  if exists (
    select 1 from unnest(v_all) x
    where not exists (
      select 1 from public.children c where c.id = x and c.tenant_id = v_tenant
    )
  ) then
    raise exception '他法人の児童は指定できません';
  end if;

  select c.sibling_group_id into v_old_group from public.children c where c.id = p_child_id;

  /* きょうだい無し = 紐付け解除 */
  if coalesce(array_length(p_sibling_ids, 1), 0) = 0 then
    update public.children set sibling_group_id = null where id = p_child_id;
  else
    /* 既存グループがあれば再利用する（別事業所の職員が先に作っている場合を含む）。
       複数のグループが混ざっている場合は、最初に見つかった 1 つに寄せる。 */
    select c.sibling_group_id into v_group
    from public.children c
    where c.id = any(v_all) and c.sibling_group_id is not null
    limit 1;

    if v_group is null then
      insert into public.sibling_groups (tenant_id, facility_id, label)
      values (v_tenant, v_facility, null)
      returning id into v_group;
    end if;

    update public.children set sibling_group_id = v_group where id = any(v_all);

    /* 選択から外された児童は解除する（この児童の元グループに限る） */
    if v_old_group is not null then
      update public.children
        set sibling_group_id = null
        where sibling_group_id = v_old_group and not (id = any(v_all));
    end if;
  end if;

  /* 1 人以下になったグループは意味を持たないので後始末する（請求担当設定も一緒に消える） */
  if v_old_group is not null and v_old_group is distinct from v_group then
    select count(*) into v_remaining from public.children where sibling_group_id = v_old_group;
    if v_remaining <= 1 then
      update public.children set sibling_group_id = null where sibling_group_id = v_old_group;
      delete from public.sibling_groups where id = v_old_group;
    end if;
  end if;

  return v_group;
end;
$$;

comment on function public.set_child_siblings(uuid, uuid[]) is
  '児童のきょうだいを設定する。触るのは children.sibling_group_id のみで、'
  ' 児童の他の属性・請求額には一切触れない。兄弟が別事業所に通う場合に'
  ' 相手側の行も更新する必要があるため SECURITY DEFINER。'
  ' 自テナント内であることを検証する。admin / manager / shift_manager のみ。migration 225';

revoke all on function public.get_sibling_candidates() from public;
revoke all on function public.set_child_siblings(uuid, uuid[]) from public;
grant execute on function public.get_sibling_candidates() to authenticated;
grant execute on function public.set_child_siblings(uuid, uuid[]) to authenticated;
