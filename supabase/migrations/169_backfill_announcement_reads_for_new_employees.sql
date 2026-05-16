-- 169: 新人入社時の「未読お知らせ大量」問題を解消する。
--
-- 入社時点で既に公開されていたお知らせは employees 行作成時に
-- announcement_reads に一括 INSERT して既読扱いにする。
-- これでログイン直後の未読バッジが 0 件から始まり、入社後に公開された
-- お知らせだけが未読として表示される。
--
-- 過去ログ自体は /my/announcements 一覧から普通に閲覧可能（フィルタはしない）。
--
-- 注意: migration 139 の trg_notify_announcement_read が announcement_reads
-- INSERT 毎に「X が お知らせを確認しました」を admin/manager に飛ばすため、
-- バックフィルで通知欄が爆発しないよう transaction-local GUC で抑止する。
-- compliance / training / manual は別物（新人も読まされる必要があるため
-- 既読化対象に含めない）。

-- 1) 通知トリガを GUC で抑止可能なバージョンに差し替え。
--    通常運用での挙動は変えない（GUC が立っている時だけ skip）。
create or replace function public.trg_notify_announcement_read()
returns trigger as $$
declare
  v_title text;
  v_tenant_id uuid;
begin
  if current_setting('app.suppress_announcement_read_notify', true) = '1' then
    return NEW;
  end if;

  select a.title, a.tenant_id into v_title, v_tenant_id
  from public.announcements a
  where a.id = NEW.announcement_id;

  if v_tenant_id is null then return NEW; end if;

  perform public.insert_completion_notifications(
    v_tenant_id,
    NEW.employee_id,
    'announcement_read',
    NEW.announcement_id,
    v_title
  );
  return NEW;
end;
$$ language plpgsql security definer;

-- 2) 新人作成時に既存の公開済お知らせを一括既読化するトリガ。
create or replace function public.trg_backfill_announcement_reads_for_new_employee()
returns trigger as $$
begin
  -- 退職者として登録された場合はスキップ
  if NEW.status <> 'active' then
    return NEW;
  end if;

  -- このトランザクション内のみ通知発火を抑止
  perform set_config('app.suppress_announcement_read_notify', '1', true);

  insert into public.announcement_reads (announcement_id, employee_id)
  select a.id, NEW.id
  from public.announcements a
  where a.tenant_id = NEW.tenant_id
    and a.is_published = true
  on conflict (announcement_id, employee_id) do nothing;

  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_backfill_announcement_reads_for_new_employee on public.employees;
create trigger trg_backfill_announcement_reads_for_new_employee
  after insert on public.employees
  for each row execute function public.trg_backfill_announcement_reads_for_new_employee();
