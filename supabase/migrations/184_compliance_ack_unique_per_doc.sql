-- 184: compliance_acknowledgments のデータ整理 + UNIQUE 戻し
--
-- 背景:
-- migration 017 で UNIQUE を (employee_id, compliance_document_id, document_updated_at) に
-- 拡張し、書類編集 → updated_at 更新 → employee 再 ack のたびに新規行を INSERT する
-- 運用にしていた。一方で employee_progress view (migration 110) は
--   (SELECT count(*) FROM compliance_acknowledgments WHERE employee_id = e.id)
-- と版を区別せず数えていたため、書類を編集して再 ack を受けるたびに古い版の
-- ack 行が累積し、現公開件数を超えた count (例: 52/51) が表示されていた。
--
-- 修正方針:
-- - 古い版 (重複) を物理削除して 1 (employee, document) = 1 行 に正規化
-- - UNIQUE を (employee_id, compliance_document_id) に戻し、再 ack は UPSERT で
--   document_updated_at を上書きする運用に変更 (client 側 upsert と対)
--
-- この migration で行を消すため作業前に件数を確認しておくことを推奨:
--   SELECT COUNT(*) FROM (
--     SELECT id, row_number() OVER (
--       PARTITION BY employee_id, compliance_document_id
--       ORDER BY document_updated_at DESC NULLS LAST, acknowledged_at DESC
--     ) AS rn FROM public.compliance_acknowledgments
--   ) t WHERE t.rn > 1;

BEGIN;

-- 1) 各 (employee_id, compliance_document_id) について最新版 1 行だけ残す
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY employee_id, compliance_document_id
           ORDER BY document_updated_at DESC NULLS LAST, acknowledged_at DESC
         ) AS rn
  FROM public.compliance_acknowledgments
)
DELETE FROM public.compliance_acknowledgments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) 旧 UNIQUE (017 由来) を外して新 UNIQUE を張る
ALTER TABLE public.compliance_acknowledgments
  DROP CONSTRAINT IF EXISTS compliance_ack_emp_doc_version_key;

ALTER TABLE public.compliance_acknowledgments
  ADD CONSTRAINT compliance_ack_emp_doc_unique
  UNIQUE (employee_id, compliance_document_id);

COMMENT ON CONSTRAINT compliance_ack_emp_doc_unique ON public.compliance_acknowledgments IS
  '184: 1 社員 × 1 書類 = 1 行。再 ack 時はクライアント側で upsert (onConflict) により
   document_updated_at + acknowledged_at を上書き。古い版の行が累積して
   employee_progress.compliance_done が分母を超える問題 (52/51) を解消する。';

COMMIT;

NOTIFY pgrst, 'reload schema';
