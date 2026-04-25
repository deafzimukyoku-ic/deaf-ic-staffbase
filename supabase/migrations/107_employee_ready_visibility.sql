-- 107_employee_ready_visibility.sql
-- 案Z（仮シフト方式）対応:
-- employee も自分の分の shift_assignments / transport_assignments を
-- publish_status='ready' の段階から閲覧可能にする。
-- 既存の sa_employee_read_published / ta_employee_read_published を上書きする。
--
-- 背景: ready は「仮シフト・社内レビュー」だが、実運用では職員に仮シフトを
-- 見せて「有給使えない」「時間調整して」等のフィードバック（shift_change_requests）を
-- もらってから正式公開（published）する流れにする。

-- shift_assignments: employee は ready / published の自分の分のみ閲覧可
drop policy if exists sa_employee_read_published on public.shift_assignments;
drop policy if exists sa_employee_read_ready_or_published on public.shift_assignments;
create policy sa_employee_read_ready_or_published on public.shift_assignments for select
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and publish_status in ('ready', 'published')
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  );

-- transport_assignments: 同様に ready / published を閲覧可
drop policy if exists ta_employee_read_published on public.transport_assignments;
drop policy if exists ta_employee_read_ready_or_published on public.transport_assignments;
create policy ta_employee_read_ready_or_published on public.transport_assignments for select
  using (
    get_my_role() = 'employee'
    and tenant_id = get_my_tenant_id()
    and publish_status in ('ready', 'published')
    and employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
  );
