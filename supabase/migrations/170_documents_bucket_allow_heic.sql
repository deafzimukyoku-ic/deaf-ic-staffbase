-- 170: documents バケットの allowed_mime_types を拡張。
--
-- iPhone (iOS 11+) のデフォルト写真形式 HEIC が拒否されて、
-- お知らせ / 遵守事項 / 研修 / 業務マニュアル の画像アップロードが
-- BlockEditor 経由で全て失敗していた。
-- employee-images / message-attachments バケットと足並みを揃え、
-- heic / heif / gif を追加する。

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'video/mp4'
]
where id = 'documents';
