-- 178: メッセージ添付に外部 URL リンクをサポート
--
-- これまで message_attachments は Storage にアップロードされたファイルのみを
-- 持っていたが、PDF や動画の外部 URL (Google Drive, YouTube 等) を直接共有したい
-- 要望に応えて link_url カラムを追加。
--
-- 仕様:
--   link_url = NULL → 従来通り Storage ファイル (storage_path 必須)
--   link_url = 値あり → URL リンク (storage_path は NULL でも可)
--   file_name は「表示ラベル」として両方で使う
--   mime_type / size_bytes は NULL 許容 (link_url のときは不明)

ALTER TABLE public.message_attachments
  ADD COLUMN IF NOT EXISTS link_url text;

/* storage_path / mime_type を NULL 許容に (link 専用エントリのため) */
ALTER TABLE public.message_attachments
  ALTER COLUMN storage_path DROP NOT NULL,
  ALTER COLUMN mime_type DROP NOT NULL,
  ALTER COLUMN size_bytes DROP NOT NULL;

/* どちらか必須: storage_path OR link_url。両方 NULL は無効 */
ALTER TABLE public.message_attachments
  DROP CONSTRAINT IF EXISTS attach_payload_required;
ALTER TABLE public.message_attachments
  ADD CONSTRAINT attach_payload_required
  CHECK (storage_path IS NOT NULL OR link_url IS NOT NULL);

COMMENT ON COLUMN public.message_attachments.link_url IS
  '178: 外部 URL リンク (Google Drive / YouTube 等)。'
  'NULL = Storage ファイル / 値あり = リンク添付。';

NOTIFY pgrst, 'reload schema';
