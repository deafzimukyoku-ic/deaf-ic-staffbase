-- 211: 短期 Signed URL 発行可否判定 RPC
--
-- API /api/storage/sign がこの関数を呼んでアクセス権を判定する。
-- true → service_role でSigned URL 発行 / false → 403
--
-- 退職者ブロックを RLS (migration 210) と RPC の二重ガードで担保。
-- DB 側ロジック集約により、後から判定変更時もコード変更 + デプロイ不要 (SQL migration のみで完結)。

create or replace function public.can_access_media_path(p_path text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp record;
  v_path_tenant text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select e.tenant_id::text as tenant_id, e.status
    into v_emp
    from public.employees e
   where e.auth_user_id = auth.uid()
   limit 1;

  if not found then
    return false;
  end if;
  if v_emp.status <> 'active' then
    return false;
  end if;

  -- buildStoragePath は `<prefix>/<tenant_id>/<filename>` 形式を生成 (lib/upload-helpers.ts)。
  -- 過去の API route 経由 `<tenant_id>/<filename>.pdf` も互換維持 (207 RLS と同じ判定)。
  v_path_tenant := coalesce(
    (string_to_array(p_path, '/'))[2],
    (string_to_array(p_path, '/'))[1]
  );
  if v_path_tenant is null then
    return false;
  end if;
  if v_path_tenant <> v_emp.tenant_id then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.can_access_media_path(text) from public;
grant execute on function public.can_access_media_path(text) to authenticated;

notify pgrst, 'reload schema';
