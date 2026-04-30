-- 133_cleanup_qualifications.sql
-- employees.qualifications / shift_qualifications に紛れている「ゴミ要素」を除去する。
--
-- 原因:
--   migration 114 で text → text[] に変換した際、元の値が
--     - "[]"   （空配列を JSON 文字列として保存していた）
--     - "{}"
--     - ""    （空文字）
--     - "null"
--     - "  "  （空白のみ）
--   だった行は string_to_array で「その文字列を 1 要素持つ配列」に化けてしまい、
--   UI 側で資格バッジとして「[]」などが表示される問題が発生していた。
--
-- 対策:
--   両カラムから空文字 / "[]" / "{}" / "null" / 空白のみ要素を除去。
--   array_remove は完全一致のみなので、unnest + filter + array_agg で書き直す。

-- qualifications
update public.employees e
   set qualifications = coalesce(
     (
       select array_agg(x)
         from unnest(e.qualifications) as x
        where x is not null
          and btrim(x) <> ''
          and btrim(x) <> '[]'
          and btrim(x) <> '{}'
          and lower(btrim(x)) <> 'null'
     ),
     '{}'::text[]
   )
 where exists (
   select 1 from unnest(e.qualifications) as x
    where x is null
       or btrim(x) = ''
       or btrim(x) = '[]'
       or btrim(x) = '{}'
       or lower(btrim(x)) = 'null'
 );

-- shift_qualifications (migration 129 で追加。同じく旧データに混入の可能性)
update public.employees e
   set shift_qualifications = coalesce(
     (
       select array_agg(x)
         from unnest(e.shift_qualifications) as x
        where x is not null
          and btrim(x) <> ''
          and btrim(x) <> '[]'
          and btrim(x) <> '{}'
          and lower(btrim(x)) <> 'null'
     ),
     '{}'::text[]
   )
 where shift_qualifications is not null
   and exists (
     select 1 from unnest(e.shift_qualifications) as x
      where x is null
         or btrim(x) = ''
         or btrim(x) = '[]'
         or btrim(x) = '{}'
         or lower(btrim(x)) = 'null'
   );
