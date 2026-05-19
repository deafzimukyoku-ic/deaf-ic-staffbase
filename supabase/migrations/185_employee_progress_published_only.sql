-- 185: employee_progress view を「公開 + 現バージョン一致」のみカウントに正規化
--
-- 背景:
-- migration 110 の view は素 count(*) を返していたため、以下の累積バグがあった:
--   - 非公開化された compliance_documents の ack も数えてしまう
--   - 非公開化された trainings の合格も数えてしまう
--   - 184 で ack 整理しても、もし古いゴミ行が残ると永遠に分母超え
--
-- 修正:
-- 4 機能 (compliance / trainings / announcements / manuals) について
--   - その時点で is_published=true のアイテム経由の ack/read/submission のみ
--   - compliance は加えて document_updated_at = current updated_at の行のみ
-- にフィルタする。これで「現公開アイテム数」を分母とする UI と分子も整合する。
--
-- 注意: SECURITY INVOKER 維持。migration 110 と同じく view 経由でも employee の
-- RLS は効く (自分の行のみ可視)。

DROP VIEW IF EXISTS employee_progress;

CREATE VIEW employee_progress
WITH (security_invoker = true)
AS
  SELECT
    e.id AS employee_id,
    e.tenant_id,
    e.facility_id,
    (SELECT count(*) FROM document_submissions ds
      WHERE ds.employee_id = e.id AND ds.status = 'submitted') AS docs_submitted,

    /* compliance: 公開中 かつ ack が現バージョン (document_updated_at = current) のものだけ */
    (SELECT count(*) FROM compliance_acknowledgments ca
      JOIN compliance_documents cd ON cd.id = ca.compliance_document_id
      WHERE ca.employee_id = e.id
        AND cd.is_published = true
        AND ca.document_updated_at = cd.updated_at) AS compliance_done,

    /* trainings: 公開中 + 合格判定のみ */
    (SELECT count(*) FROM training_submissions ts
      JOIN trainings t ON t.id = ts.training_id
      WHERE ts.employee_id = e.id
        AND ts.result = 'passed'
        AND t.is_published = true) AS trainings_passed,

    /* announcements: 公開中のみ */
    (SELECT count(*) FROM announcement_reads ar
      JOIN announcements a ON a.id = ar.announcement_id
      WHERE ar.employee_id = e.id
        AND a.is_published = true) AS announcements_read,

    /* manuals: 公開中のみ */
    (SELECT count(*) FROM manual_reads mr
      JOIN manuals m ON m.id = mr.manual_id
      WHERE mr.employee_id = e.id
        AND m.is_published = true) AS manuals_read
  FROM employees e;

COMMENT ON VIEW employee_progress IS
  '185: 4機能の達成数を「公開 + 現バージョン一致」でカウント。
   分子が分母を超える 52/51 バグの根本対応。SECURITY INVOKER 維持で RLS バイパス無し。';

NOTIFY pgrst, 'reload schema';
