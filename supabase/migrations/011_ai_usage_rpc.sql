-- 011: AI使用量カウントアップRPC
create or replace function increment_ai_usage(p_tenant_id uuid, p_year_month text)
returns void as $$
begin
  insert into ai_diagnosis_usage (tenant_id, year_month, count)
  values (p_tenant_id, p_year_month, 1)
  on conflict (tenant_id, year_month)
  do update set count = ai_diagnosis_usage.count + 1;
end;
$$ language plpgsql security definer;
