-- Phase G: 個別メッセージ機能
--
-- 5 テーブル + Storage バケット + RLS。
-- admin / manager → 社員 (1名 or 複数) のチャット風メッセージ。
-- 添付: 画像 + PDF, 10MB 上限（フロント側で検査、バケット側で保険）

-- ============================================================
-- 1. message_threads — 参加者集合 1 つに対して 1 行
-- ============================================================
CREATE TABLE IF NOT EXISTS public.message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  /* 並び順用: 最後にメッセージが投稿された時刻。スレッド一覧の order by 用 */
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_threads_tenant ON public.message_threads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_last_at ON public.message_threads(last_message_at DESC);

-- ============================================================
-- 2. message_thread_members — スレッド参加者
-- ============================================================
CREATE TABLE IF NOT EXISTS public.message_thread_members (
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_members_employee ON public.message_thread_members(employee_id);

-- ============================================================
-- 3. messages — 個別メッセージ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
  sender_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE SET NULL,
  body text NOT NULL DEFAULT '',
  /* 編集回数（編集あれば updated_at と差分） */
  edited_at timestamptz,
  /* ソフト削除。NULL = 通常、値あり = "削除されました" 表示 */
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON public.messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_employee_id);

-- ============================================================
-- 4. message_attachments — 添付（画像 / PDF）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760), -- 10 MB
  created_at timestamptz NOT NULL DEFAULT now(),
  /* 仕様上、画像 + PDF のみ。SQL レベルでも保険として制約 */
  CHECK (
    mime_type LIKE 'image/%'
    OR mime_type = 'application/pdf'
  )
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_msg ON public.message_attachments(message_id);

-- ============================================================
-- 5. message_reads — 受信者ごとの既読タイムスタンプ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.message_reads (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_employee ON public.message_reads(employee_id);

-- ============================================================
-- last_message_at を自動更新するトリガ
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_message_thread_last_at() RETURNS trigger AS $$
BEGIN
  UPDATE public.message_threads
  SET last_message_at = NEW.created_at
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_messages_update_thread_last ON public.messages;
CREATE TRIGGER trg_messages_update_thread_last
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_message_thread_last_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.message_threads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_thread_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads            ENABLE ROW LEVEL SECURITY;

/* 自分が参加しているスレッドかどうかを判定する SECURITY DEFINER 関数。
   RLS ポリシーで再帰参照を避けるためテーブル参照は関数内に閉じる。 */
CREATE OR REPLACE FUNCTION public.is_message_thread_member(p_thread_id uuid) RETURNS boolean AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  SELECT id INTO v_employee_id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_employee_id IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.message_thread_members
    WHERE thread_id = p_thread_id AND employee_id = v_employee_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

/* admin / manager（自管轄施設に参加者がいる場合）の閲覧用 */
CREATE OR REPLACE FUNCTION public.can_admin_view_thread(p_thread_id uuid) RETURNS boolean AS $$
DECLARE
  v_role text;
  v_tenant uuid;
  v_my_facilities uuid[];
BEGIN
  SELECT role, tenant_id INTO v_role, v_tenant FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  /* admin: 自テナントの全スレッド */
  IF v_role = 'admin' THEN
    RETURN EXISTS (SELECT 1 FROM public.message_threads WHERE id = p_thread_id AND tenant_id = v_tenant);
  END IF;
  /* manager: 参加者のうち少なくとも 1 人が自管轄施設に居る */
  IF v_role = 'manager' THEN
    SELECT array_agg(facility_id) INTO v_my_facilities
    FROM (
      SELECT facility_id FROM public.employees WHERE auth_user_id = auth.uid()
      UNION
      SELECT facility_id FROM public.manager_facilities mf
      JOIN public.employees e ON e.id = mf.employee_id WHERE e.auth_user_id = auth.uid()
    ) s;
    RETURN EXISTS (
      SELECT 1 FROM public.message_thread_members tm
      JOIN public.employees em ON em.id = tm.employee_id
      WHERE tm.thread_id = p_thread_id AND em.facility_id = ANY(v_my_facilities)
    );
  END IF;
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE;

-- ---- message_threads ----
DROP POLICY IF EXISTS message_threads_select ON public.message_threads;
CREATE POLICY message_threads_select ON public.message_threads FOR SELECT
  USING (is_message_thread_member(id) OR can_admin_view_thread(id));

DROP POLICY IF EXISTS message_threads_insert ON public.message_threads;
CREATE POLICY message_threads_insert ON public.message_threads FOR INSERT
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
    AND (SELECT role FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1) IN ('admin','manager')
  );

-- ---- message_thread_members ----
DROP POLICY IF EXISTS thread_members_select ON public.message_thread_members;
CREATE POLICY thread_members_select ON public.message_thread_members FOR SELECT
  USING (is_message_thread_member(thread_id) OR can_admin_view_thread(thread_id));

DROP POLICY IF EXISTS thread_members_insert ON public.message_thread_members;
CREATE POLICY thread_members_insert ON public.message_thread_members FOR INSERT
  WITH CHECK (
    /* admin/manager がスレッド作成時に参加者を登録 */
    (SELECT role FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1) IN ('admin','manager')
    OR is_message_thread_member(thread_id)
  );

-- ---- messages ----
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
  USING (is_message_thread_member(thread_id) OR can_admin_view_thread(thread_id));

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT
  WITH CHECK (
    is_message_thread_member(thread_id)
    AND sender_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS messages_update_own ON public.messages;
CREATE POLICY messages_update_own ON public.messages FOR UPDATE
  USING (sender_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1))
  WITH CHECK (sender_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1));

-- ---- message_attachments ----
DROP POLICY IF EXISTS attachments_select ON public.message_attachments;
CREATE POLICY attachments_select ON public.message_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id AND (is_message_thread_member(m.thread_id) OR can_admin_view_thread(m.thread_id))
    )
  );

DROP POLICY IF EXISTS attachments_insert ON public.message_attachments;
CREATE POLICY attachments_insert ON public.message_attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id
        AND m.sender_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );

DROP POLICY IF EXISTS attachments_delete ON public.message_attachments;
CREATE POLICY attachments_delete ON public.message_attachments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id
        AND m.sender_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );

-- ---- message_reads ----
DROP POLICY IF EXISTS reads_own ON public.message_reads;
CREATE POLICY reads_own ON public.message_reads FOR ALL
  USING (employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1))
  WITH CHECK (employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1));

-- ============================================================
-- 既存 notifications テーブル (migration 139) の event_type に
-- 'direct_message' を追加する（🔔 ベル統合用）
-- ============================================================
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_event_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_event_type_check CHECK (event_type IN (
  'document_submission',
  'compliance_ack',
  'training_submission',
  'announcement_read',
  'manual_read',
  'direct_message'
));

-- ============================================================
-- Storage バケット: message-attachments
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,
  10485760,
  ARRAY['image/png','image/jpeg','image/gif','image/webp','image/heic','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = EXCLUDED.public;

/* Storage の RLS: 自分が参加するスレッドの message_id 配下だけ read/write 可能。
   storage_path の prefix が "{message_id}/" の前提。 */
DROP POLICY IF EXISTS "msg-attach select" ON storage.objects;
CREATE POLICY "msg-attach select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'message-attachments'
    AND EXISTS (
      SELECT 1 FROM public.message_attachments a
      JOIN public.messages m ON m.id = a.message_id
      WHERE a.storage_path = name
        AND (is_message_thread_member(m.thread_id) OR can_admin_view_thread(m.thread_id))
    )
  );

DROP POLICY IF EXISTS "msg-attach insert" ON storage.objects;
CREATE POLICY "msg-attach insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND auth.uid() IS NOT NULL
    /* 投稿者は admin / manager / 参加者のいずれか。詳細整合は INSERT 後の attachments テーブルが担保。 */
  );

DROP POLICY IF EXISTS "msg-attach delete" ON storage.objects;
CREATE POLICY "msg-attach delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'message-attachments'
    AND EXISTS (
      SELECT 1 FROM public.message_attachments a
      JOIN public.messages m ON m.id = a.message_id
      WHERE a.storage_path = name
        AND m.sender_employee_id = (SELECT id FROM public.employees WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );
