# content-media-parity-with-diletto

> diletto-new-staffbase の `video-signed-url` + `storage-orphan-cleanup` 仕様書を参考に、deaf-ic 側の動画/画像/PDF アップロードに残っている UX 欠落・バケット未分離・Storage 孤児問題・Phase 3 未着手データを一括で揃える機能仕様。
> 既存仕様 [content-media-signed-url.md](content-media-signed-url.md) の **Phase 3 拡張 + 追加 Phase** として扱う (差し戻し型で上書きしない)。
> 承認日: 2026-05-27 (Phase A 着手)

## 0. ユーザー判断確定事項 (2026-05-27)

| Q | 採用案 | 含意 |
|---|---|---|
| 反映範囲 | **C. 全体 (Phase 3 含む)** | UX 改善 + 削除同期 + 既存 Drive 動画13/PDF17/画像2件の Storage 移行 まで一括 |
| videos バケット分離 | **B. 作る (diletto 同様)** | 動画専用 `videos` バケット (500 MB / video/mp4\|webm\|mov) を新設。画像/PDF は documents 継続 |
| YouTube/Drive URL 入力欄 | **C. 完全削除 (Storage のみ)** | 新規動画ブロックは Storage アップロードのみ。既存 YouTube/Drive 動画は BlockRenderer 側で互換維持 (新規追加不可) |

---

## 1. 機能概要

- **機能名**: content-media-parity-with-diletto
- **目的**: 既に Phase 1/2 (DB migration 210/211/212 + `/api/storage/sign` + `useSignedMediaUrl` + `SignedMedia` 系 + BlockEditor/Renderer の storage_path 経路) は実装済。残る diletto との差分:
  1. クライアント側 size + MIME バリデーションが無い (Supabase バケット側 file_size_limit に丸投げ、ユーザーフィードバックが弱い)
  2. アップロード成功時の toast が出ない
  3. 動画専用 `videos` バケットが無く、200 MB 上限の documents バケットを共用 → diletto は 500 MB の videos バケットを分離
  4. 投稿削除時 / ブロック差し替え時の Storage 同期削除が無い → 孤児ファイルが溜まる
  5. BlockEditor の新規動画ブロック default が YouTube になっており、Drive URL も貼れてしまう → 新規 Drive 投稿を構造的に禁止できていない
  6. Phase 3 既存データ移行 (Drive 動画 13本 / Drive PDF 17本 / 旧 10年 Signed URL 画像 2件) が未実行
- **スコープ(やる)**:
  1. **migration 213** = `videos` バケット新設 (private / 500 MB / `video/mp4`/`webm`/`quicktime` / tenant 分離 RLS)
  2. **`/api/storage/sign` を bucket 引数対応に拡張** (`bucket: 'documents' | 'videos'`、省略時 'documents' で後方互換)
  3. **`useSignedMediaUrl` を bucket 引数対応に拡張** + **`SignedMediaVideo` を videos バケット経由に変更**
  4. **BlockEditor 改修**: クライアント size/MIME 検証 + toast.success + 新規動画 default を `source: 'storage'` に変更 + YouTube URL 入力欄物理削除 (新規追加時) + ContentBlockJson 型を discriminated union 風に厳密化
  5. **`lib/storage/cleanup-blocks.ts` 新規** (`collectStoragePaths` / `deleteStorageForBlocks` / `diffRemovedPaths`)
  6. **8 ページの削除関数 + 保存関数に Storage 削除組み込み** (admin × 4機能 + manager × 4機能)
  7. **Phase 3 移行スクリプト実行**: 既存 `scripts/migrate-drive-to-storage.mjs` + `scripts/backfill-image-signed-urls.mjs` を dry-run → 本番実行 (動画は新 videos バケットへ)
- **スコープ(やらない)**:
  - 動画トランスコード / HLS / 自動サムネ / 字幕
  - employee-images バケット (社員プロフィール画像) の RLS 強化 — 別脅威モデル
  - メッセージ添付 (`message_attachments`) の削除同期 — 別ライフサイクル
  - Drive 側ファイル物理削除 — 移行成功 7 日後の手作業に分離 (既存 spec の Phase 4)
  - 削除リトライキュー / cron 経由の孤児掃除 — 致命的でないため将来対応
  - 並列削除 / トランザクション保証
  - TTL の変更 (現状 動画 60min / 画像 PDF 10min 維持)
  - YouTube URL 入力欄の物理削除 — 互換維持のため legacy データの編集表示は残置 (新規追加 UI のみ消す)

---

## 2. 影響範囲

> impact-catalog.md より該当のみ。Stack: Next.js 16 + Supabase + Vercel Hobby (Pro 移行は Phase 1 で完了済前提)。

1. **DB スキーマ** [supabase, sql]
   - 既存テーブルの列追加なし
   - `manuals.content_blocks` / `trainings.content_blocks` / `announcements.content_blocks` / `compliance_items.content_blocks` の JSON shape は既存 `ContentBlockJson` を踏襲 (Phase 1/2 で確定済)
2. **RLS / 権限ポリシー** [supabase]
   - 新規 `videos` バケット用 SELECT/ALL policy 2 本 (`videos: tenant members can read` + `videos: admin or manager can manage`、status='active' 条件付き、deaf-ic migration 210 と同パターン)
   - `documents` バケット側は変更なし
3. **マイグレーション** [supabase, sql]
   - `supabase/migrations/213_videos_storage_bucket.sql` 新規 (バケット作成 + RLS 2 本)
   - `scripts/apply-migration-213.mjs` 新規 (pooler 経由、既存 211/212 と同パターン)
   - migration-applied.md / storage-policy-snapshot.json 更新
4. **型定義** [ts]
   - `lib/types.ts:591` の `ContentBlockJson` を厳密化:
     ```ts
     export type ContentBlockJson =
       | { type: 'text'; value: string }
       | { type: 'image'; source: 'storage'; storage_path: string; caption?: string }
       | { type: 'image'; source: 'legacy_signed_url'; url: string; caption?: string }   // 旧 10年 Signed URL 救済
       | { type: 'video'; source: 'storage'; storage_path: string }
       | { type: 'video'; source: 'youtube'; url: string }                                // 互換維持
       | { type: 'video'; source: 'google_drive'; url: string }                           // 互換維持 (新規追加不可)
       | { type: 'pdf'; source: 'storage'; storage_path: string; label?: string }
       | { type: 'pdf'; source: 'google_drive'; url: string; label?: string };            // 互換維持 (新規追加不可)
     ```
   - 既存 8 ページ + BlockEditor + BlockRenderer の型エラーは TypeScript で機械的に拾えるので 1 周回して直す
5. **API / Server 関数** [next]
   - `app/api/storage/sign/route.ts` を bucket 引数対応に拡張:
     - body: `{ bucket?: 'documents' | 'videos'; path: string }` (bucket 省略時 'documents')
     - path 正規表現: documents `^[a-z_]+\/[a-f0-9-]{36}\/[\w.+-]+$` / videos `^videos\/[a-f0-9-]{36}\/[\w.+-]+$`
     - RPC `can_access_media_path` は path だけで判定するため引数追加不要 (path 内 tenant_id が一致するかは RPC が見る)
     - signed URL 発行: 動画 (videos バケット or 拡張子) は 60 分 / 画像 PDF は 10 分 (既存ルール踏襲)
   - `can_access_media_path` RPC (migration 211) が `videos/` プレフィックスを許容しているか確認 → 必要なら migration 214 で RPC を更新
6. **バリデーション** [next]
   - クライアント側 (BlockEditor):
     - 画像: max 10 MB / MIME whitelist `image/jpeg`,`image/png`,`image/webp`,`image/heic`,`image/heif`,`image/gif`
     - 動画: max 500 MB / MIME whitelist `video/mp4`,`video/webm`,`video/quicktime`
     - PDF: max 50 MB / MIME whitelist `application/pdf`
     - 違反時 `toast.error('...サイズが上限...を超えています', { description: '選択されたファイル: ... MB' })`
   - サーバ側 (`/api/storage/sign`): path 正規表現で 1 階層目を whitelist (`manuals|trainings|announcements|compliance|content|videos`)
7. **Cron / バッチ** — 該当なし
8. **キャッシュ / CDN** [next]
   - `useSignedMediaUrl` のモジュールキャッシュキーを `${bucket}:${path}` に変更 (現状 path だけ)
   - Signed URL は token クエリ付きなのでユーザー間共有不可
9. **外部連携** [-]
   - Phase 3 移行時のみ Drive `usercontent.google.com/download` を叩いて mp4/pdf をダウンロード → Supabase Storage 再アップロード
   - 移行完了後は Drive 参照ゼロ
10. **UI / コンポーネント** [next, react]
    - `components/admin/BlockEditor.tsx` 大幅改修:
      - size 定数 + MIME whitelist 定数を追加
      - `handleImageUpload` / `handleVideoUpload` / `handlePdfUpload` に size + MIME チェック + toast.success 追加
      - `uploadToStorage()` 共通関数の bucket 引数追加 (動画は videos、それ以外は documents)
      - 新規動画ブロックの `addBlock('video')` default を `{ type: 'video', source: 'storage', storage_path: '' }` に変更
      - 動画ブロックの YouTube/Drive URL 入力欄を**新規追加時のみ非表示**にする (legacy データの編集 UI は維持)
      - 新規 image ブロックの `addBlock('image')` default を `{ type: 'image', source: 'storage', storage_path: '', caption: '' }` に変更
      - 新規 PDF ブロックも同様
    - `components/media/SignedMedia.tsx`:
      - `SignedMediaVideo` を videos バケット経由に変更 (新規 props か内部判定。`useSignedMediaUrl(path, 'videos')` の形)
      - `SignedMediaImage` / `SignedMediaPdf` は documents 継続
    - `components/admin/BlockRenderer.tsx`:
      - `SignedMediaVideo` 呼び出しの調整 (props 変更があれば反映)
      - YouTube / Drive 互換 PDF / 旧 Signed URL 画像の表示分岐は**残置** (既存データ救済)
    - 8 ページ (admin × 4 + manager × 4) の **編集モーダル + 削除関数**:
      - 各 `handleDelete(id)` 内で `from(table).select('content_blocks').single()` → `deleteStorageForBlocks()` → `delete()` の順
      - 各編集保存関数で `oldBlocks` を fetch → `diffRemovedPaths()` で差分 → `deleteStorageForBlocks()` → `update()` の順
11. **状態管理** [react] — 既存 `useSignedMediaUrl` のモジュールキャッシュをそのまま流用。bucket キー追加のみ
12. **ルーティング / URL** [next] — 該当なし (既存 `/api/storage/sign` を拡張)
13. **モバイル / レスポンシブ** [any]
    - 既存どおり `<video playsInline>` / `<iframe>` + 別タブリンク fallback
14. **i18n** — 該当なし
15. **Auth / セッション** [any]
    - 既存 RPC `can_access_media_path` が `status='active'` 判定 → 退職時に自然に 403
    - videos バケットのパスも同じ tenant チェックロジックで通せるよう RPC を確認
16. **メール・通知テンプレート** — 該当なし
17. **ログ / 監査** [any]
    - Storage 削除失敗時は `console.warn('[cleanup-blocks] failed', { bucket, path, error })` のみ。DB 削除は続行 (孤児許容、致命は逆向き)
18. **検索インデックス** — 該当なし
19. **エクスポート / インポート** — 該当なし
20. **環境変数 / 設定** — 既存のみ。新規 env なし
21. **テスト** [-] — 手動テスト中心
22. **ドキュメント** [any]
    - `docs/reference-map.md` — videos バケット + 新 migration 213 + cleanup-blocks ヘルパ追記
    - `docs/constraints.md` — Supabase 容量上限 + バケット分離方針を追記
    - `docs/migration-applied.md` — 213 行追加
    - `docs/storage-policy-snapshot.json` — 適用前後で再 snapshot (CLAUDE.md §16-3 義務)
    - `docs/error-log.md` — Phase 完了エントリ追加
    - `docs/progress.html` — 本機能を追加

---

## 3. 表出箇所マップ

- **サイドバー / ナビゲーション**: 該当なし
- **ダッシュボード / トップのカード・ウィジェット**: 該当なし
- **設定画面の項目**: 該当なし
- **通知 / トースト / モーダル**:
  - BlockEditor アップロード成功時 → `toast.success('画像/動画/PDF をアップロードしました')`
  - size 超過 → `toast.error('〜サイズが上限〜を超えています', { description: '選択されたファイル: X.X MB' })`
  - MIME 不一致 → `toast.error('対応していない〜形式です', { description: '... のみ対応 (選択: ...)' })`
  - tenant 未取得 → `toast.error('テナント情報が取得できていません')`
  - Supabase StorageError → `toast.error('〜アップロードに失敗しました', { description: error.message })`
  - Storage 削除失敗 (投稿削除時) → トースト非表示、console.warn のみ (DB 削除は続行)
- **ヘッダー / フッター / パンくず**: 該当なし
- **ロール別の表示差異**:
  - **admin**: 全 4 機能で動画/画像/PDF アップロード可。投稿削除時に Storage 同期削除
  - **manager**: 自施設配下の 4 機能で同上
  - **employee**: BlockEditor は触らない、BlockRenderer で視聴のみ
  - **退職者 (`status='retired'`)**: API が 403 → 全メディア再生不可 (既存仕様継続)
- **モバイル時の表示**:
  - 動画: `<video playsInline>` (iOS Safari インライン再生)
  - PDF: iframe + 「📁 別タブで開く」ボタン併設
  - 画像: `<img>` をそのまま、`max-h-[65vh] object-contain`

---

## 4. 連動更新ポイント

- **migration 213 作成 + 適用** → `supabase/migrations/213_videos_storage_bucket.sql` + `scripts/apply-migration-213.mjs` + `node scripts/snapshot-storage-policies.mjs` 実行 → `docs/storage-policy-snapshot.json` git diff 同梱 + `docs/migration-applied.md` に 1 行追加
- **`can_access_media_path` RPC が videos prefix 対応か確認** → 必要なら `migration 214_can_access_media_path_videos.sql` で RPC を更新 (path 1階層目に 'videos' を許容)
- **`ContentBlockJson` 型厳密化** → `lib/types.ts:591` + `components/admin/BlockEditor.tsx`(`export type ContentBlock = ContentBlockJson`) + `components/admin/BlockRenderer.tsx` + 8 ページ (admin × 4 + manager × 4) で TypeScript エラーを潰す
- **`/api/storage/sign` を bucket 引数対応** → `app/api/storage/sign/route.ts` + クライアント側呼出箇所 (`lib/hooks/useSignedMediaUrl.ts`)
- **`useSignedMediaUrl` を bucket 引数対応** → `lib/hooks/useSignedMediaUrl.ts` + `components/media/SignedMedia.tsx` の `SignedMediaVideo` (`useSignedMediaUrl(path, 'videos')` に変更)
- **BlockEditor 改修** → `components/admin/BlockEditor.tsx`:
  - size/MIME 定数追加 + 各 handle 関数に検証追加 + toast.success 追加
  - `uploadToStorage` の bucket 引数追加
  - `addBlock('video'|'image'|'pdf')` の default を Storage 形式に
  - 動画ブロックの新規追加時 (storage_path 未設定 + url 未設定) は YouTube/Drive URL 入力欄を非表示
- **`lib/storage/cleanup-blocks.ts` 新規** → 3 関数 export
  - `collectStoragePaths(blocks): { videos: string[]; documents: string[] }`
  - `deleteStorageForBlocks(supabase, blocks): Promise<{ ok: number; failed: { bucket: string; path: string; error: string }[] }>`
  - `diffRemovedPaths(oldBlocks, newBlocks): { videos: string[]; documents: string[] }`
- **8 ページの削除/保存関数に組み込み** → 各ページの `handleDelete` + `handleSave` / `handleUpdate`:
  - admin: `app/(admin)/admin/manuals/page.tsx`, `app/(admin)/admin/trainings/page.tsx`, `app/(admin)/admin/announcements/page.tsx`, `app/(admin)/admin/compliance/page.tsx`
  - manager: `app/(manager)/mgr/manuals/page.tsx`, `app/(manager)/mgr/trainings/page.tsx`, `app/(manager)/mgr/announcements/page.tsx`, `app/(manager)/mgr/compliance/page.tsx`
  - **編集モーダルが別ファイルに分離されている場合**は実装時に発見次第追記
- **Phase 3 移行スクリプト本番実行** → `scripts/migrate-drive-to-storage.mjs --dry-run` → 結果ユーザー承認 → 本番実行 → `scripts/backfill-image-signed-urls.mjs` → 4 機能 12 画面で表示確認
- **移行スクリプトを videos バケット対応に修正** → 動画は `documents/manuals/...` でなく `videos/{tenant}/...` にアップロードするよう `scripts/migrate-drive-to-storage.mjs` を更新 (PDF は documents のまま)
- **reference-map 更新** → 新 migration / API 拡張 / cleanup-blocks ヘルパ / videos バケット を追記 + 既存 ContentBlockJson 型変更を追記
- **constraints.md 更新** → Supabase バケット分離方針 (動画は videos / 画像 PDF は documents) を追記
- **error-log 追加** → Phase 完了エントリ追加 (退職者問題の構造解決完了 + Storage 孤児問題の構造解決完了)
- **progress.html 更新** → 本仕様の Phase A/B/C の進捗ステップを追加

---

## 5. ロール別権限マトリクス

| 操作 | admin | manager | employee | 退職者 |
|---|---|---|---|---|
| 動画アップロード (videos INSERT) | ○ | ○ (自施設のみ) | ✕ | ✕ |
| 画像/PDF アップロード (documents INSERT) | ○ | ○ (自施設のみ) | ✕ | ✕ |
| 動画 Signed URL 発行 (`/api/storage/sign` bucket=videos) | ○ | ○ | ○ | ✕ (403) |
| 画像/PDF Signed URL 発行 (bucket=documents) | ○ | ○ | ○ | ✕ (403) |
| 投稿削除時の Storage 同期削除 | ○ (内部処理) | ○ (内部処理) | ✕ | ✕ |
| ブロック差し替え時の Storage 同期削除 | ○ (内部処理) | ○ (内部処理) | ✕ | ✕ |
| 移行スクリプト (`scripts/migrate-*.mjs`) 実行 | ○ (ローカル/CI) | ✕ | ✕ | ✕ |

> 退職時の伝播は最大 TTL (動画 60min / 画像 PDF 10min) 遅延 → 既存仕様継続。即時遮断は構造的に不可能 (キャッシュ済み Signed URL を持つクライアントは TTL 切れまで再生可)。

---

## 6. 既存機能との差分・依存

- **似た機能**:
  - deaf-ic 既存 Phase 1/2 (`content-media-signed-url.md`) — DB migration 210/211/212 + `/api/storage/sign` + `useSignedMediaUrl` + `SignedMedia` + BlockEditor/Renderer の storage_path 経路は実装済。本仕様はこれの**完成**
  - diletto `video-signed-url.md` + `storage-orphan-cleanup.md` — 本仕様の参考実装。**統合判断: 統合** (videos バケット + cleanup-blocks ヘルパは同じパターンを deaf-ic に移植)
- **依存する既存機能・モジュール**:
  - `lib/upload-helpers.ts:buildStoragePath` — 既存、prefix 引数を 'videos' に変えて呼ぶ
  - `lib/supabase/client.ts` / `lib/supabase/server.ts` — 既存
  - `documents` バケット (200 MB) — 既存。画像/PDF は引き続き使用
  - `employees.status` 判定の RPC `can_access_media_path` (migration 211) — 既存
  - `sonner` toast — 既存
  - `scripts/apply-migration-NNN.mjs` の pooler 接続パターン — 既存
  - 移行スクリプト `scripts/migrate-drive-to-storage.mjs` / `scripts/backfill-image-signed-urls.mjs` — 既存 (Phase 3 用、未実行)
- **この変更で影響を受ける既存機能**:
  - **マニュアル / 研修 / お知らせ / 遵守事項 の表示**: BlockRenderer 経由で全 4 機能。新動画は videos バケット経由になる
  - **`/api/storage/sign`**: bucket 引数追加で後方互換 (省略時 documents)
  - **`useSignedMediaUrl`**: bucket 引数追加で後方互換 (省略時 documents)
  - **8 ページ × 編集/削除**: handleDelete / handleSave に Storage 削除を組み込み
  - **既存 YouTube/Drive 動画 13 本 + Drive PDF 17 本 + 旧 Signed URL 画像 2 件**: Phase 3 移行で全件 storage_path 化
  - **`docs/constraints.md` §1 (動画は Vercel Function を経由させない)**: 本仕様は `<video src={signedUrl}>` で Supabase CDN 直叩き → §1 遵守

---

## 7. 実装ルール

- **命名規則**:
  - バケット: `videos` (snake_case 複数形)
  - Storage path: `videos/{tenant_uuid}/{timestamp}_{random}_{filename}.{mp4|webm|mov}` (buildStoragePath 流用)
  - migration: `213_videos_storage_bucket.sql`
  - 適用スクリプト: `scripts/apply-migration-213.mjs`
  - 共通ヘルパ: `lib/storage/cleanup-blocks.ts`
  - 関数名: `collectStoragePaths` / `deleteStorageForBlocks` / `diffRemovedPaths` (camelCase)
- **再利用すべき既存コンポーネント**:
  - `lib/upload-helpers.ts:buildStoragePath` (prefix='videos' で呼ぶ)
  - diletto BlockEditor の handle 関数構造 (size check → MIME check → setUploading → try-finally → toast)
  - 既存 `SignedMedia.tsx` の Skeleton / Error コンポーネント (色トークンを diletto から brand-* に置換)
  - 既存 `useSignedMediaUrl` のモジュールキャッシュ (キーを `${bucket}:${path}` に拡張)
  - 既存 migration 210 のポリシー構造 (`status='active'` + tenant 一致) — videos 用にバケット名だけ差し替え
- **使用デザイントークン**:
  - 色: `brand-blue` / `brand-ink` / `brand-gray` / `brand-gray-light` / `brand-red` / `brand-beige` (既存 SignedMedia と一致)
  - スケルトン: `bg-brand-gray/10 animate-pulse`
  - aspect-ratio 16:9 / `width: 'min(100%, calc(65vh * 16 / 9))'`
- **モバイル対応方針**:
  - 動画 `<video playsInline preload="metadata">`
  - PDF iframe + 「📁 別タブで開く」ボタン併設
  - レイアウトブレークポイントは既存通り (Tailwind default)
- **Signed URL TTL**: 動画 60 分 / 画像 PDF 10 分 (既存維持)
- **アップロード上限**: 動画 500 MB / 画像 10 MB / PDF 50 MB (クライアント側 + バケット `file_size_limit`)
- **削除同期エラー**: `console.warn` で記録、DB 削除は続行 (孤児許容、致命は逆向き)
- **削除順序**: Storage → DB の順 (Storage 失敗時に DB は無傷で残るほうが回復容易)

---

## 8. 完成条件

- **正常系**:
  1. admin で動画 (mp4) 50 MB / 200 MB / 499 MB を BlockEditor からアップロード → DB に `{ type:'video', source:'storage', storage_path:'videos/...' }` 保存 → 再ロードで再生
  2. admin で画像 (jpg/png/webp/heic) 5 MB / 9.9 MB を BlockEditor からアップロード → 表示 OK
  3. admin で PDF 30 MB / 49 MB を BlockEditor からアップロード → iframe 表示 OK
  4. manager (自施設) が同操作可能
  5. employee で BlockRenderer から再生 (TTL 60 分 → 50 分時点で自動再フェッチ)
  6. 投稿削除 → Supabase Studio で `videos/{tenant}/...` と `documents/{prefix}/{tenant}/...` の対象ファイル消失
  7. ブロック差し替え → 旧 storage_path のみ Storage から消える (他は残る)
  8. 既存 Drive 動画 13 本 + Drive PDF 17 本 + 旧 Signed URL 画像 2 件 すべて Phase 3 移行スクリプト実行後に再生/表示可能
  9. 新規動画ブロック追加 UI に YouTube URL 入力欄が表示されない
  10. 既存 YouTube 動画ブロックの編集は引き続き可能 (互換維持)
- **異常系**:
  - 退職 (`status='retired'`) で動画 Signed URL 発行 → 403
  - 他テナントの path → 403 (RPC で弾く)
  - 500 MB 超動画 / 10 MB 超画像 / 50 MB 超 PDF → クライアント側 toast.error、アップロード未実行
  - 非対応 MIME (svg / heic 動画 / mov 動画以外で .mp4 偽装 等) → クライアント側 toast.error
  - file_size_limit 超過 (バケット側) → toast.error + Supabase error.message 表示
  - 未認証で発行 API → 401
  - TTL 切れ後の URL 直アクセス → 403
  - Storage 削除失敗 (投稿削除時) → console.warn、DB 削除は続行 (孤児許容)
  - 既存 YouTube/Drive 動画 (legacy) → BlockRenderer で互換表示
- **境界値**:
  - 動画ちょうど 500 MB → 受領 / +1 byte → 拒否
  - 画像ちょうど 10 MB → 受領 / +1 byte → 拒否
  - PDF ちょうど 50 MB → 受領 / +1 byte → 拒否
  - 0 件のブロック削除 → cleanup-blocks ヘルパは no-op で正常終了
  - 全ブロック削除して保存 → 旧 storage_path すべて Storage から消える
- **ローカル確認項目 (`npm run dev`)**:
  1. `/admin/manuals` (or 編集モーダル経由) で動画/画像/PDF アップロード → 保存 → `/my/manuals/[id]` で表示
  2. Supabase SQL Editor で対象 employee の `status='retired'` に変更 → 再ロード → 全メディア再生不可
  3. 投稿削除 → Supabase Studio でファイル消失確認
  4. 編集モーダルでブロック差し替え → 旧ファイル消失確認
  5. `node scripts/migrate-drive-to-storage.mjs --dry-run` で 30 件検出 (動画 13 + PDF 17)
  6. `node scripts/backfill-image-signed-urls.mjs --dry-run` で 2 件検出
  7. dry-run 結果をユーザー承認後、本番実行 → 全件表示確認
- **Phase 3 移行スクリプト dry-run チェックリスト**:
  - 対象テーブル: manuals / trainings / announcements / compliance_items
  - 対象行数の集計 + 動画/PDF/画像の内訳 + 合計容量見積もり (既存 snapshot にあり)
  - Drive 側 fileId 一覧 (public 設定確認は手動)
  - Pro Storage 100 GB 枠に対する充足率 (snapshot より約 数 GB 想定)
- **将来対応として分離**:
  - employee-images バケットの active 判定追加
  - メッセージ添付の Storage 同期削除
  - 監査ログテーブル (`storage_access_logs`)
  - 動画トランスコード / 自動サムネ / 字幕
  - 削除リトライキュー (cron 経由)
  - 並列削除 / トランザクション保証
  - 退職時 Signed URL revoke (Supabase は revoke API がないため別ストレージ層への移行検討)

---

## 9. 段取り (Phase A / B / C)

### Phase A: バケット + API 基盤 (DB + サーバ)
1. `supabase/migrations/213_videos_storage_bucket.sql` + `scripts/apply-migration-213.mjs` 作成 + 適用
2. `can_access_media_path` RPC が videos prefix 対応か検査。必要なら migration 214 で更新
3. `app/api/storage/sign/route.ts` を bucket 引数対応に拡張
4. `node scripts/snapshot-storage-policies.mjs` 実行 + commit
5. `docs/migration-applied.md` 更新

### Phase B: UI + ヘルパ (クライアント)
1. `lib/types.ts` の `ContentBlockJson` 厳密化 (discriminated union)
2. `lib/hooks/useSignedMediaUrl.ts` を bucket 引数対応
3. `components/media/SignedMedia.tsx` の `SignedMediaVideo` を videos バケット経由に変更
4. `components/admin/BlockEditor.tsx` 改修 (size/MIME 検証 + toast + default Storage + URL 入力欄非表示)
5. `lib/storage/cleanup-blocks.ts` 新規
6. 8 ページの handleDelete / handleSave に組み込み (admin × 4 + manager × 4)
7. `npm run dev` で新規アップロード + 削除同期 + ブロック差し替え同期 を 4 機能 12 画面で確認

### Phase C: 既存データ移行 (Phase 3)
1. `scripts/migrate-drive-to-storage.mjs` を videos バケット対応に修正 (動画は videos / PDF は documents)
2. dry-run 実行 → 結果ユーザー承認
3. 本番実行 → 動画 13 本が videos/{tenant}/...、PDF 17 本が documents/{prefix}/{tenant}/... に
4. `scripts/backfill-image-signed-urls.mjs` 実行 (画像 2 件を storage_path 化)
5. 4 機能 12 画面で全件表示確認
6. `docs/error-log.md` + `docs/constraints.md` + `docs/progress.html` 仕上げ

> Drive 側ファイル削除 (移行成功 7 日後) は既存 `content-media-signed-url.md` の Phase 4 で別途実施。

---

## 10. リスクと緩和策

| リスク | 緩和策 |
|---|---|
| videos バケット作成で既存 documents のオブジェクトに影響 | バケットは独立。新規作成のみで既存 documents は無変更 |
| `can_access_media_path` RPC が videos prefix を許容していない | Phase A-2 で RPC を SELECT して確認。許容していなければ migration 214 で update |
| ContentBlockJson 厳密化で既存データが型エラー | 既存データは `source` 未設定 (null/undefined) のものがある可能性。BlockRenderer 側の判定で `source` が無い場合は legacy 扱いに fallback |
| 8 ページの handleDelete 改修漏れ | refmap registry に `handleDelete` シンボルを登録 → `bash docs/refmap/build.sh` で機械的に洗い出し |
| Phase 3 移行スクリプトが本番動画 13 本を二重アップロード | スクリプトは fileId をキーに idempotent 化済 (要確認、改修時は dry-run で検証) |
| Storage 削除失敗で孤児が溜まる | 致命的でないため許容。将来 cron で掃除 |
| 動画 60 分 TTL でも長時間動画は再生途中で切れる | 1 動画あたり最大 60 分の業務的制約として明示 |

---

> 本ドラフトの承認をもって Phase A (バケット + API 基盤) に着手する。Phase A 完了後に Phase B、最後に Phase C の順で進める。
> 既存 [content-media-signed-url.md](content-media-signed-url.md) の Phase 3/4 は本仕様の Phase C に統合する。

---

## 11. Phase D: viewer-guard 移植 (2026-05-27 追加 / diletto 20e7406)

### 経緯
diletto-new-staffbase の commit 20e7406 で「動画 DL できるなら Drive と変わらない、画面録画も禁止したい」というユーザー指摘への対応として viewer-guard が追加された。deaf-ic にも同じ抑止策を移植する。

### スコープ (やる)
- `components/media/SignedMedia.tsx` に共通ヘルパを追加:
  - `useFullscreenContainer<T>()` — 親 div を fullscreen にして watermark を一緒に拡大する hook
  - `FullscreenButton` — 拡大/縮小の共通アイコンボタン
  - `WatermarkLabel` — 右上半透明ウォーターマーク表示
  - `useViewerWatermark()` — 視聴者の `last_name + first_name + employee_number` を employees から取得
- `SignedMediaImage` / `SignedMediaVideo` / `SignedMediaPdf` の 3 コンポーネントに viewer-guard を適用:
  - 動画: `controlsList="nodownload nofullscreen"` + `disablePictureInPicture` + `onContextMenu prevent` + watermark + 独自フルスクリーン
  - 画像: `<a target="_blank">` 削除 + `onContextMenu prevent` + `draggable={false}` + `select-none` + watermark + 独自フルスクリーン
  - PDF: 親 div の `onContextMenu prevent` + 「別タブで開く」リンク削除 + watermark + 独自フルスクリーン

### スコープ (やらない / 技術的限界)
- **OS レベルの画面録画は Web 側から防止不可** → ウォーターマークで追跡可能化により抑止
- **PDF iframe 内側のブラウザ標準 viewer の DL/印刷ボタンは cross-origin で制御不可** → 同上
- 既存 YouTube/Drive 動画ブロックの BlockRenderer 表示は本仕様対象外 (互換維持データのため)

### 連動更新ポイント
- `components/media/SignedMedia.tsx` — 上記 4 hook/component 追加 + 3 コンポーネント更新
- `components/admin/BlockRenderer.tsx` — 変更なし (`SignedMediaImage`/`Video`/`Pdf` の props は同じため自動追随)
- BlockEditor 側は image/video/PDF のプレビュー表示にも `SignedMediaImage` を使っているので、admin 編集中も viewer-guard が効く (= 編集者自身もウォーターマーク付き表示になる、これは仕様)

### ロール別差異
本機能は表示時 viewer-guard なので、ロールに関係なく全員に同じ抑止策がかかる (admin / manager / employee 共通)。退職者は API 403 で表示自体不可。

### 完成条件
- 動画再生時に「コントロールバーに DL アイコンが無い」「右クリックメニューが出ない」「右上に氏名 + 社員番号のウォーターマーク」「左上に独自フルスクリーンボタン、押すと watermark も大きくなる」
- 画像表示時に「右クリックメニューが出ない」「ドラッグできない」「テキスト選択不可」「右上 watermark」「左上独自フルスクリーン」
- PDF 表示時に「親 div 上で右クリックメニューが出ない」「右上 watermark」「左上独自フルスクリーン」(iframe 内側の標準 viewer 機能は制御不可で残る)
- 既存 video / image / PDF 表示 (Phase B/C 完了後の Storage コンテンツ) で全部に上記が効く


---

### 2026-06-12 改修: 動画/PDF を URL 入力に戻した（Storage 一本化を部分撤回）
- **背景**: Supabase プロジェクト全体の Storage アップロード上限が 50MB のままで、50MB 超の動画/PDF を Storage に上げられない（→ `docs/error-log.md`「The object exceeded the maximum allowed size」）。グローバル上限引き上げ（Pro 前提・要 Dashboard / Management API）はユーザー判断で見送り
- **変更**: `BlockEditor` の動画/PDF を Storage アップロードから **URL 入力（YouTube / Google Drive）に一本化**。画像は引き続き Storage アップロード。既存の Storage 動画/PDF（移行済み 5 動画 + PDF 群）は編集画面でプレビュー + 「削除して URL に変更」が可能で、employee 側 `SignedMedia` 表示も継続（非破壊）
- **トレードオフ（承認済み）**: URL 方式（Drive/YouTube）は退職者 403 ガードもウォーターマークも効かない。URL を知っていれば誰でも閲覧可能。研修動画等で許容との判断
- **未対応**: Drive→Storage 移行で取り残した 50MB 超 11 件はそのまま Drive URL で表示（`content_blocks` に残存: manuals 10 / trainings 2）。グローバル上限を上げれば移行再開可能
