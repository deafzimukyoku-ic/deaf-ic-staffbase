-- 186: 閲覧レポート用 view_logs の過去分バックフィル
--
-- 背景:
-- migration 111 で compliance_view_logs / training_view_logs /
-- announcement_view_logs / manual_view_logs を新設したが、それ以前から既に存在
-- していた ack/read/submission 行に対する view_log は作られなかった。
-- 結果:
--   社員画面 (ack/read 行を見て表示)        → 「同意済 / 既読 / 合格」
--   閲覧レポート (view_logs を集計)         → 「✗ 未読」
-- が乖離して、admin から「ちゃんと読んでるのに未読扱い」と見えていた。
--
-- 修正:
-- 4 カテゴリの「既存 ack/read/submission に対応する view_log が無い」レコードを
-- 1 件につき 1 行 INSERT して補填。
-- viewed_at は元の acknowledged_at / read_at / submitted_at を流用 (ユーザー承認済)。
-- NOT EXISTS で重複防止しているので冪等再実行可。

-- 遵守事項
INSERT INTO public.compliance_view_logs (tenant_id, employee_id, item_id, viewed_at)
SELECT DISTINCT
  e.tenant_id,
  ca.employee_id,
  ca.compliance_document_id,
  COALESCE(ca.acknowledged_at, now())
FROM public.compliance_acknowledgments ca
JOIN public.employees e ON e.id = ca.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.compliance_view_logs cvl
  WHERE cvl.employee_id = ca.employee_id
    AND cvl.item_id = ca.compliance_document_id
);

-- お知らせ
INSERT INTO public.announcement_view_logs (tenant_id, employee_id, item_id, viewed_at)
SELECT DISTINCT
  e.tenant_id,
  ar.employee_id,
  ar.announcement_id,
  COALESCE(ar.read_at, now())
FROM public.announcement_reads ar
JOIN public.employees e ON e.id = ar.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.announcement_view_logs avl
  WHERE avl.employee_id = ar.employee_id
    AND avl.item_id = ar.announcement_id
);

-- 業務マニュアル
INSERT INTO public.manual_view_logs (tenant_id, employee_id, item_id, viewed_at)
SELECT DISTINCT
  e.tenant_id,
  mr.employee_id,
  mr.manual_id,
  COALESCE(mr.read_at, now())
FROM public.manual_reads mr
JOIN public.employees e ON e.id = mr.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.manual_view_logs mvl
  WHERE mvl.employee_id = mr.employee_id
    AND mvl.item_id = mr.manual_id
);

-- 研修 (submitted_at を流用)
INSERT INTO public.training_view_logs (tenant_id, employee_id, item_id, viewed_at)
SELECT DISTINCT
  e.tenant_id,
  ts.employee_id,
  ts.training_id,
  COALESCE(ts.submitted_at, now())
FROM public.training_submissions ts
JOIN public.employees e ON e.id = ts.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.training_view_logs tvl
  WHERE tvl.employee_id = ts.employee_id
    AND tvl.item_id = ts.training_id
);

COMMENT ON TABLE public.compliance_view_logs IS
  '111: 詳細モーダルを開いた回数を append-only で記録。186 で過去 ack 分をバックフィル済。';

NOTIFY pgrst, 'reload schema';
