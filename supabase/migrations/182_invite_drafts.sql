-- 182: 社員招待 下書き保存テーブル
--
-- 背景:
-- /admin/employees/new で長文 (緊急連絡先・通勤経路・複数施設兼任 等) を入力中に
-- 別件で離脱せざるをえないことがある。書きかけを localStorage ではなく DB に保存
-- して別端末からでも続きを書けるようにする。
--
-- 仕様:
-- - admin が自分宛にのみ作成・閲覧・更新・削除可 (RLS で強制)
-- - facility_id は下書きの所属候補 (NULL = 未確定)
-- - form_data jsonb: 招待フォーム全フィールドの値スナップショット
-- - note: 「Aさん 入社準備」等の admin 用メモ (任意)
-- - 招待 (POST /api/employees/invite) 成功時に自動削除する想定 (UI 側で実施)
--
-- 認可:
-- - DB RLS は「自分の下書きのみ」で十分。
-- - admin 以外がそもそも /admin/employees/new に到達しないが、API 側でも role='admin' チェック必須
--   (middleware + API ガード)。

CREATE TABLE IF NOT EXISTS public.invite_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  admin_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  form_data jsonb NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_drafts_admin ON public.invite_drafts(admin_employee_id, updated_at DESC);

COMMENT ON TABLE public.invite_drafts IS
  '182: 社員招待の下書き保存。admin が長文フォーム入力途中で離脱→別端末で再開 を可能にする。';

ALTER TABLE public.invite_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invite_drafts_select ON public.invite_drafts;
CREATE POLICY invite_drafts_select ON public.invite_drafts FOR SELECT
USING (
  admin_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
);

DROP POLICY IF EXISTS invite_drafts_insert ON public.invite_drafts;
CREATE POLICY invite_drafts_insert ON public.invite_drafts FOR INSERT
WITH CHECK (
  admin_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
  AND tenant_id = (SELECT tenant_id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
);

DROP POLICY IF EXISTS invite_drafts_update ON public.invite_drafts;
CREATE POLICY invite_drafts_update ON public.invite_drafts FOR UPDATE
USING (
  admin_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
);

DROP POLICY IF EXISTS invite_drafts_delete ON public.invite_drafts;
CREATE POLICY invite_drafts_delete ON public.invite_drafts FOR DELETE
USING (
  admin_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
);

/* updated_at 自動更新トリガー */
CREATE OR REPLACE FUNCTION public.update_invite_drafts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invite_drafts_updated_at ON public.invite_drafts;
CREATE TRIGGER invite_drafts_updated_at
  BEFORE UPDATE ON public.invite_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_invite_drafts_updated_at();

NOTIFY pgrst, 'reload schema';
