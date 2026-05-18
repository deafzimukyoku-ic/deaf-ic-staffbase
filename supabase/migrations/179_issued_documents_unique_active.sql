-- 179: issued_documents の active 発行に対する部分 UNIQUE INDEX
--
-- 173/174 で個別発行・一括発行・招待時自動発行の 3 経路ができたが、
-- DB UNIQUE 制約が無いため、特に一括発行ボタンの 2 連発 / 同時 2 タブ実行で
-- 同一 (employee_id, document_template_id) が複数 active で残る重複が発生していた。
--
-- 本マイグレーションは以下を行う:
--  (1) 既存重複の整理:
--      同一 (employee_id, document_template_id) で revoked_at IS NULL が 2 件以上ある場合、
--      issued_at が最新の 1 件のみ残し、それ以外を revoked_at=now() で取消にする。
--      revoked_reason に 'migration 179: 重複発行の整理 (旧コピーを取消)' を記録。
--  (2) 部分 UNIQUE INDEX 作成:
--      (employee_id, document_template_id) が revoked_at IS NULL の範囲で一意。
--      revoke してからの再発行は引き続き可能。
--
-- 同時に lib/issued-documents/issue-helper.ts に INSERT 直前の dedup チェックを追加し、
-- 通常運用では UNIQUE 違反まで到達しない 2 段構えにする (本 INDEX は最終防御)。

BEGIN;

-- (1) 既存重複の整理: 各重複グループで最新 1 件だけ残して旧を revoke
WITH ranked AS (
  SELECT id,
         employee_id,
         document_template_id,
         issued_at,
         ROW_NUMBER() OVER (
           PARTITION BY employee_id, document_template_id
           ORDER BY issued_at DESC, id DESC
         ) AS rn
  FROM public.issued_documents
  WHERE revoked_at IS NULL
)
UPDATE public.issued_documents AS d
SET revoked_at = now(),
    revoked_reason = 'migration 179: 重複発行の整理 (旧コピーを取消)'
FROM ranked r
WHERE d.id = r.id
  AND r.rn > 1;

-- (2) 部分 UNIQUE INDEX
CREATE UNIQUE INDEX IF NOT EXISTS issued_documents_active_unique
  ON public.issued_documents (employee_id, document_template_id)
  WHERE revoked_at IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
