-- 173: 書類発行 (会社→社員) 一式
--
-- 背景:
-- 雇用契約書 / 辞令 / 給与明細 / 健診結果通知 など「会社が社員に渡す書類」を
-- 社員詳細ページから個別発行 → 在籍社員は /my/documents の「会社から届いた書類」
-- カードに表示、退職社員は Resend 経由でメール添付送信する逆方向フロー。
-- 既存「社員→会社 提出」(document_submissions) とは完全に独立。
--
-- 構成:
-- 1. テーブル issued_documents (tenant_id + facility_id 二重スコープ、
--    発行者・受信者・PDF パス・配信モード・受領確認・取り消しを保持)
-- 2. 2 つの SECURITY DEFINER 関数 (本人判定 / admin・管轄 manager 判定)
-- 3. RLS ポリシー (SELECT / INSERT / 本人 UPDATE / admin UPDATE)
-- 4. Storage バケット 'issued-documents' (private, 20MB, PDF only) と Storage RLS
-- 5. notifications.event_type CHECK に 'document_issued' を追加 (142 を ALTER で上書き)

-- ============================================================
-- 1. テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS public.issued_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  document_template_id uuid NOT NULL REFERENCES public.document_templates(id) ON DELETE RESTRICT,

  /* 発行者。発行者退職後も表示が消えないよう name はスナップショット保持 */
  issued_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  issued_by_name text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),

  /* 生成 PDF (Storage 'issued-documents' バケット内のオブジェクト名) */
  generated_pdf_path text,

  /* 発行コメント (オプション。NULL = コメントなし) */
  message text,

  /* 配信モード: in_app (在籍社員へカード表示) / email_only (退職者へメール添付) */
  delivery_mode text NOT NULL DEFAULT 'in_app'
    CHECK (delivery_mode IN ('in_app', 'email_only')),

  /* メール送信結果 (email_only 時のみ) */
  email_sent_at timestamptz,
  email_to_address text,
  email_error text,

  /* 社員側アクション (in_app 時のみ意味あり) */
  viewed_at timestamptz,
  acknowledged_at timestamptz,

  /* 取り消し */
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  revoked_reason text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issued_docs_employee ON public.issued_documents(employee_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_docs_tenant ON public.issued_documents(tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_docs_facility ON public.issued_documents(facility_id, issued_at DESC);

COMMENT ON TABLE public.issued_documents IS
  '173: 会社→社員 書類発行履歴。在籍社員は in_app (UI カード)、退職社員は email_only (メール添付) で配信。';

ALTER TABLE public.issued_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. SECURITY DEFINER 関数
-- ============================================================

-- 自分宛の発行書類か判定
CREATE OR REPLACE FUNCTION public.is_own_issued_document(p_employee_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees
    WHERE id = p_employee_id AND auth_user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE;

GRANT EXECUTE ON FUNCTION public.is_own_issued_document(uuid) TO authenticated;

-- admin / 管轄 manager の閲覧・操作権限 (自管轄施設のみ)
CREATE OR REPLACE FUNCTION public.can_admin_view_issued_document(
  p_facility_id uuid,
  p_tenant_id uuid
) RETURNS boolean AS $$
DECLARE
  v_role text;
  v_my_tenant uuid;
  v_my_id uuid;
BEGIN
  SELECT id, role, tenant_id INTO v_my_id, v_role, v_my_tenant
  FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_my_id IS NULL THEN RETURN false; END IF;
  IF v_my_tenant <> p_tenant_id THEN RETURN false; END IF;
  IF v_role IN ('admin', 'super_admin') THEN RETURN true; END IF;
  IF v_role = 'manager' THEN
    /* p_facility_id が NULL の発行 (旧データ等) はテナント admin のみ可、manager は不可 */
    IF p_facility_id IS NULL THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = v_my_id AND e.facility_id = p_facility_id
    ) OR EXISTS (
      SELECT 1 FROM public.manager_facilities mf
      WHERE mf.employee_id = v_my_id AND mf.facility_id = p_facility_id
    );
  END IF;
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

GRANT EXECUTE ON FUNCTION public.can_admin_view_issued_document(uuid, uuid) TO authenticated;

-- ============================================================
-- 3. RLS ポリシー
-- ============================================================
DROP POLICY IF EXISTS issued_docs_select ON public.issued_documents;
CREATE POLICY issued_docs_select ON public.issued_documents FOR SELECT
  USING (
    public.is_own_issued_document(employee_id)
    OR public.can_admin_view_issued_document(facility_id, tenant_id)
  );

DROP POLICY IF EXISTS issued_docs_insert ON public.issued_documents;
CREATE POLICY issued_docs_insert ON public.issued_documents FOR INSERT
  WITH CHECK (public.can_admin_view_issued_document(facility_id, tenant_id));

/* 本人: viewed_at / acknowledged_at のみ更新可 (API 側で列を制限) */
DROP POLICY IF EXISTS issued_docs_update_self ON public.issued_documents;
CREATE POLICY issued_docs_update_self ON public.issued_documents FOR UPDATE
  USING (public.is_own_issued_document(employee_id))
  WITH CHECK (public.is_own_issued_document(employee_id));

/* admin / 管轄 manager: revoke 等更新可 (列制限は API 側で) */
DROP POLICY IF EXISTS issued_docs_update_admin ON public.issued_documents;
CREATE POLICY issued_docs_update_admin ON public.issued_documents FOR UPDATE
  USING (public.can_admin_view_issued_document(facility_id, tenant_id))
  WITH CHECK (public.can_admin_view_issued_document(facility_id, tenant_id));

-- ============================================================
-- 4. Storage バケット
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'issued-documents',
  'issued-documents',
  false,
  20971520,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

/* Storage RLS: 自分宛か admin・管轄 manager のみ SELECT 可。
   INSERT / DELETE は service-role API 経由のみ (ポリシー不要、bypass される) */
DROP POLICY IF EXISTS "issued-docs select" ON storage.objects;
CREATE POLICY "issued-docs select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'issued-documents'
    AND EXISTS (
      SELECT 1 FROM public.issued_documents id_rec
      WHERE id_rec.generated_pdf_path = name
        AND (
          public.is_own_issued_document(id_rec.employee_id)
          OR public.can_admin_view_issued_document(id_rec.facility_id, id_rec.tenant_id)
        )
    )
  );

-- ============================================================
-- 5. notifications.event_type CHECK 拡張
--    142 で 6 種 (document_submission, compliance_ack, training_submission,
--    announcement_read, manual_read, direct_message) → 173 で
--    'document_issued' を追加して 7 種に。
-- ============================================================
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_event_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_event_type_check CHECK (event_type IN (
  'document_submission',
  'compliance_ack',
  'training_submission',
  'announcement_read',
  'manual_read',
  'direct_message',
  'document_issued'
));

NOTIFY pgrst, 'reload schema';
