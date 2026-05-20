-- 188: content-version-tracking 用の版基準カラム追加
--
-- 目的:
-- 閲覧レポートとダッシュボード「社員進捗一覧」が「現版閲覧済み」を共通ルールで
-- 判定できるよう、4 カテゴリに版基準日時カラムを揃える。
--   - compliance_documents (005) / manuals (091) は updated_at を既に持つ → 変更なし
--   - announcements: updated_at を新設。全編集で前進させたいので BEFORE UPDATE
--     トリガで自動更新する (ユーザー承認: トリガ方式)。
--   - trainings: recert_at を新設。研修だけは「再受講を求める」を admin/manager が
--     編集時に選んだときだけ前進させる仕様 → トリガは付けず、app が明示セットする。
--
-- バックフィル必須:
-- ADD COLUMN ... DEFAULT now() のままだと既存全行が「今編集された」状態になり、
-- 過去の閲覧 view_log がすべて「旧版」に落ちる。created_at で埋め直して
-- 「未編集アイテムは全員が現版」を保つ。
--
-- トリガ方式の不統一について (意図的):
-- announcements のみ DB トリガ。compliance_documents / manuals は従来どおり
-- admin ページが updated_at を明示セットする app 管理方式のまま (承認時決定)。
-- 既存挙動を変えないことを優先。

BEGIN;

-- 1) announcements.updated_at (全編集で前進。後段でトリガを張る)
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 既存行のバックフィル (トリガ作成前に実行すること。順序厳守)
UPDATE public.announcements SET updated_at = created_at;

-- 2) trainings.recert_at (再受講基準。トリガは付けない = app が明示セット)
ALTER TABLE public.trainings
  ADD COLUMN IF NOT EXISTS recert_at timestamptz NOT NULL DEFAULT now();

UPDATE public.trainings SET recert_at = created_at;

COMMENT ON COLUMN public.trainings.recert_at IS
  '188: 再受講基準日時。admin/manager が研修編集時に「再受講を求める」を選んだ
   ときだけ app が now() に更新する。閲覧 view_log の viewed_at がこれ以上なら
   「現版」、未満なら「旧版」。トリガでは更新しない。';

-- 3) updated_at 自動更新トリガ関数 (冪等)。今回は announcements のみに attach。
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- バックフィル後にトリガ作成 (作成前だと UPDATE で now() に上書きされてしまう)
DROP TRIGGER IF EXISTS trg_announcements_set_updated_at ON public.announcements;
CREATE TRIGGER trg_announcements_set_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.announcements.updated_at IS
  '188: 編集日時。BEFORE UPDATE トリガ (trg_announcements_set_updated_at) で
   全編集時に now() へ自動更新。閲覧 view_log の viewed_at がこれ以上なら現版。';

COMMIT;

NOTIFY pgrst, 'reload schema';
