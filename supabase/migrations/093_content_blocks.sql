-- 093_content_blocks.sql
-- 遵守事項・研修・お知らせ・業務マニュアル に「ブロックエディタ」対応
-- text / image / video / pdf ブロックの配列を jsonb で保存

-- content_blocks: [{type:'text',value:'...'},{type:'image',url:'...',caption:''},{type:'video',url:'...',source:'youtube'|'google_drive'},{type:'pdf',url:'...',label:''}]
ALTER TABLE public.compliance_documents
  ADD COLUMN IF NOT EXISTS content_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.trainings
  ADD COLUMN IF NOT EXISTS content_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS content_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS content_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 既存の body/content は残す（後方互換・NEW バッジ判定の補助）
-- content_blocks が空配列の場合は body/content をテキストブロックとして扱う
COMMENT ON COLUMN public.compliance_documents.content_blocks IS 'ブロックエディタの内容。空配列なら content を単一テキストブロックとして扱う';
COMMENT ON COLUMN public.trainings.content_blocks IS 'ブロックエディタの内容';
COMMENT ON COLUMN public.trainings.body IS '研修の説明本文（ブロックエディタ未使用時のフォールバック）';
COMMENT ON COLUMN public.announcements.content_blocks IS 'ブロックエディタの内容。空配列なら body を単一テキストブロックとして扱う';
COMMENT ON COLUMN public.manuals.content_blocks IS 'ブロックエディタの内容。空配列なら body を単一テキストブロックとして扱う';
