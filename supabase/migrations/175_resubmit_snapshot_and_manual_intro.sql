-- 175: タグ再提出 精密化 (snapshot 方式) + 初回ログイン マニュアル誘導
--
-- ## 1. document_submissions.employee_snapshot jsonb
-- 提出時の employees 行を丸ごとスナップショット。再提出判定時は
-- 「テンプが実際に参照する employee カラム」だけを snapshot と現在値で比較し、
-- 関係のないカラム (住所未使用書類の住所変更など) では再提出を促さない。
-- NULL = 過去提出 (snapshot 取得前) → /my/documents 側で従来の
-- updated_at vs submitted_at 比較に fallback。
--
-- ## 2. employees.manual_intro_first_seen_at timestamptz
-- 「今日から換算して初めて /my/* を開いたとき」にマニュアル「職員ステーションの
-- 使い方」誘導ダイアログを 1 度だけ出すためのフラグ。
-- NULL = まだ表示していない / 値あり = 表示済 (再表示しない)。
-- 既存社員も全員 NULL なので、デプロイ後の初回 /my/* アクセスでポップ表示される。

ALTER TABLE public.document_submissions
  ADD COLUMN IF NOT EXISTS employee_snapshot jsonb;

COMMENT ON COLUMN public.document_submissions.employee_snapshot IS
  '175: 提出時の employees 行スナップショット。再提出判定 (テンプ参照カラムだけ snapshot vs 現在値) に使う。';

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS manual_intro_first_seen_at timestamptz;

COMMENT ON COLUMN public.employees.manual_intro_first_seen_at IS
  '175: 「職員ステーションの使い方」マニュアル誘導ダイアログを表示した時刻。NULL = 未表示。';

NOTIFY pgrst, 'reload schema';
