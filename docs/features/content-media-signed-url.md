# content-media-signed-url

> マニュアル / 研修 / お知らせ / 遵守事項 の動画・PDF・画像を Supabase Storage + 短期 Signed URL に**全件移行**し、退職者の URL 直アクセスを構造的にブロックする機能仕様。
> 承認日: 2026-05-26 (Phase 0 着手)
> 仕様書本文は `docs/features/feature-spec-template.md` に従う。

## 0. ユーザー判断確定事項 (2026-05-26)

| Q | 採用案 | 含意 |
|---|---|---|
| 既存 Drive 動画/PDF の扱い | **B. 全件移行** | 既存 Drive ファイルを全件ダウンロード → Supabase Storage に再アップロード → DB の URL を `storage_path` に書き換え → Drive 側ファイル削除(or 共有解除) を**本仕様内**で実施 |
| Supabase プラン | **Pro 移行を検討** | 動画は容量大のため Free 1 GB では即超過。**Pro 契約完了を本仕様実装の前提条件**とする。契約前は動画アップロード UI を `disabled` でガード |
| 画像も短 TTL 化 | **B. 既存も含めて全件短 TTL 化** | 既存 `ContentBlockJson` 内の 10 年 Signed URL から `storage_path` を抽出 → DB 行を `storage_path` ベースに変換 → 表示は都度発行モデルへ統一 |

---

## 1. 機能概要

- **機能名**: content-media-signed-url
- **目的**:
  4 機能(マニュアル / 研修 / お知らせ / 遵守事項)の動画・PDF・画像が、現状 Google Drive 「リンクを知っている全員」共有 + 画像は 10 年 Signed URL という構造になっており、**退職者が URL をメモしていれば退職後も閲覧できる**。これを Supabase Storage の **短期 Signed URL(動画 60 分 / PDF・画像 10 分)** + **発行 API で `employees.status='active'` チェック**に置き換え、退職フラグを立てた瞬間にメディアアクセスが止まる構造に切り替える。**既存メディアも全件移行**して退職対策の穴をなくす。
- **スコープ(やる)**:
  1. `ContentBlockJson` の型変更(`url` → `storage_path` ベース + `source: 'storage'` 追加。`'google_drive'` 値は廃止)
  2. Signed URL 発行 API `POST /api/storage/sign` + RPC `request_signed_media_url`(active 判定)
  3. BlockEditor に動画・PDF の **Storage 直アップロード UI** を追加(現状は URL 貼付けのみ)
  4. BlockRenderer に Signed URL 都度取得ロジック追加(新 hook `useSignedMediaUrl`)
  5. `documents` バケットの SELECT RLS に `status='active'` 条件を追加
  6. 動画用に `documents` バケットの `file_size_limit` を引き上げ(初期値 200 MB、constraints.md に併記)
  7. **既存 Drive 動画/PDF の一括移行スクリプト**(`scripts/migrate-drive-to-storage.mjs`) — Drive ダウンロード + Storage アップロード + `content_blocks` JSON 更新
  8. **既存 10 年 Signed URL 画像のバックフィルスクリプト**(`scripts/backfill-image-signed-urls.mjs`) — Signed URL から storage_path を逆抽出 + `content_blocks` JSON 更新
  9. 移行完了後の Drive 側ファイル削除手順を delivery checklist に追加
- **スコープ(やらない)**:
  - Workspace アカウント発行 / Drive 個別共有運用(B 案)
  - 動画変換 / 圧縮(ユーザー側で事前準備した mp4 をそのまま上げる)
  - employee-images バケット(プロフィール画像等)の RLS 強化 — 別の脅威モデル / 別仕様
  - PWA Push subscription レコードの退職者削除 — 別仕様(`docs/features/pwa-push-notifications.md` の延長)
  - Cloudflare Stream 等への動画専用 CDN 移行 — 将来検討

---

## 2. 影響範囲

> impact-catalog.md からピック。Stack: Next.js 16 + Supabase + Vercel Hobby + (Supabase Pro 移行予定)。

1. **DB スキーマ** [supabase, sql]
   - `manuals.content_blocks` / `trainings.content_blocks` / `announcements.content_blocks` / `compliance_items.content_blocks` の `ContentBlockJson` 形式変更
     - 旧: `{ type: 'video'; url: 'https://drive.google.com/file/d/.../view'; source: 'youtube' | 'google_drive' }`
     - 新: `{ type: 'video'; storage_path: string; source: 'youtube' | 'storage' }`(YouTube 系は `youtube_url` 別フィールドへ分離 or `external_url` を維持)
     - 確定形式: `{ type: 'video'; source: 'youtube'; external_url: string } | { type: 'video'; source: 'storage'; storage_path: string }`(discriminated union)
   - 既存行はバックフィルスクリプトで Drive → Storage 化 + JSON 書換
2. **RLS / 権限ポリシー** [supabase]
   - `documents` バケット SELECT ポリシー (`documents: tenant members can read`) に `EXISTS (SELECT 1 FROM employees WHERE auth_user_id = auth.uid() AND status = 'active')` を追加
   - `documents` バケット ALL ポリシー (`documents: admin or manager can manage`) も同 active 条件を追加
   - 新 RPC `request_signed_media_url(p_path text) returns table(signed_url text, expires_at timestamptz)`
     - `SECURITY DEFINER` で `auth.uid()` → employees lookup → `status='active'` + `tenant_id` 一致を判定 → `storage.create_signed_url` 相当
3. **マイグレーション / シード** [supabase, sql]
   - `supabase/migrations/210_active_only_documents_rls.sql` (documents バケット RLS 強化)
   - `supabase/migrations/211_signed_media_rpc.sql` (RPC 新設)
   - `supabase/migrations/212_documents_bucket_size_limit.sql` (file_size_limit 200 MB に引上げ + 動画 MIME 追加検討)
   - `supabase/migrations/213_content_blocks_storage_migration.sql` (ContentBlockJson 旧形式 → 新形式の DB 側バリデーション + comment)
   - **データ移行は SQL マイグレーションではなく Node スクリプトで実施**(Drive からのダウンロードが必要なため)
4. **型定義** [ts]
   - `lib/types.ts:585` の `ContentBlockJson` 更新
   - `components/admin/BlockEditor.tsx:13` の `ContentBlock` 更新(DRY 化: types.ts から import するよう統合検討)
5. **API / Server 関数** [next]
   - 新規: `app/api/storage/sign/route.ts` (POST) — body `{ path: string }` → `{ signed_url, expires_at }`。RPC `request_signed_media_url` を呼ぶ
   - 新規(オプション): `app/api/storage/upload-media/route.ts` (POST multipart) — 動画/PDF アップロード前提条件チェック後 Storage 書込 / または **クライアント直 SDK アップロード方式を継続** (現行画像と同じ)
6. **バリデーション** [next]
   - 動画 MIME: `video/mp4` (現状 documents バケット allowed_mime_types 済)
   - PDF MIME: `application/pdf`
   - 画像 MIME: 現状通り
   - サイズ上限: 動画 200 MB / PDF 20 MB / 画像 10 MB(constraints.md §1 に併記)
7. **Cron / バッチ** [vercel]
   - 不要(短期 Signed URL は自然失効)
   - 既存 10 年 Signed URL の物理クリーンアップは migration スクリプト内で一度実行(継続 Cron 不要)
8. **キャッシュ / CDN** [next, vercel]
   - Signed URL TTL: **動画 60 分 / PDF・画像 10 分**(動画は再生中 expire 防止のため長め)
   - SWR `dedupingInterval`: 動画 50 分 / 画像 PDF 8 分(TTL の 80%)
   - Signed URL レスポンスに `Cache-Control: private, max-age=540` (画像) / `max-age=3300` (動画)
9. **外部連携** [-]
   - Drive: 移行完了までは存在。移行スクリプト実行中のみ Drive API or 公開 URL 経由でダウンロード。完了後は参照ゼロ
   - Anthropic PDF 解析: 影響なし(`issued-documents` バケット使用、本仕様対象外)
10. **UI / コンポーネント** [next, react]
    - `components/admin/BlockEditor.tsx` — 動画/PDF タイプに「ファイルアップロード」入力追加。**Supabase Pro 契約完了フラグ未設定なら動画アップロードボタンを `disabled` + ツールチップ「Pro プラン契約後に有効化されます」表示**
    - `components/admin/BlockRenderer.tsx` — Drive 分岐撤去。`storage_path` のみ対応。新 hook で都度発行 → `<video src>` / `<iframe src>` / `<img src>`
    - 新規: `lib/hooks/useSignedMediaUrl.ts` (SWR ベース)
    - 新規: `components/media/SignedMediaImage.tsx` / `SignedMediaVideo.tsx` / `SignedMediaPdf.tsx` (SWR + skeleton + 再試行ボタン)
11. **状態管理** [react]
    - SWR キャッシュキー: `['signed-media', path]`
    - global dedupe (同一ページの複数ブロックで同 path)
12. **ルーティング / URL** [next]
    - `app/api/storage/sign/route.ts` 新設
13. **モバイル / レスポンシブ** [any]
    - 動画 `<video playsInline>` 必須
    - PDF iframe は Supabase Storage の inline 表示が iOS Safari でどう動くか **要実機確認**(`Content-Disposition: inline` ヘッダ次第)
    - Signed URL 取得失敗時はスケルトン → 再試行ボタン
14. **i18n** — 該当なし
15. **Auth / セッション** [any]
    - 発行 RPC は `auth.uid()` 経由で employees lookup → セッション切れで 401
    - `status` 変更後の伝播は**最大 TTL (動画 60 分 / 画像 10 分) 遅延**で旧 URL は期限内見られる(仕様として明示)
16. **メール・通知テンプレート** — 該当なし
17. **ログ / 監査** [any]
    - 退職者から発行リクエストが来た場合に `console.warn` で記録(本格的な監査テーブルは将来対応)
18. **検索インデックス** — 該当なし
19. **エクスポート / インポート** — 該当なし
20. **環境変数 / 設定** [any]
    - 既存 `SUPABASE_SERVICE_ROLE_KEY` を発行 API で使用 (必須)
    - 新規 env なし
21. **テスト** [-]
    - 手動テスト中心
    - 移行スクリプトの dry-run モード必須(本番実行前に件数 + 容量見積もり)
22. **ドキュメント** [any]
    - `docs/reference-map.md` — 新 RPC / API / カラム形式追記
    - `docs/constraints.md` §1 関連 case + Storage 容量上限を追記
    - `docs/error-log.md` — 「退職後アクセス問題」エントリ追加
    - `docs/migration-applied.md` — 210/211/212/213 記録
    - `docs/storage-policy-snapshot.json` — 移行前後で snapshot 取得(CLAUDE.md §16-3 義務)
    - `docs/progress.html` — 計画 #11 として記録

---

## 3. 表出箇所マップ

- **サイドバー / ナビゲーション**: 該当なし
- **ダッシュボード / トップのカード・ウィジェット**: 該当なし
- **設定画面の項目**: 該当なし(admin UI に「メディアアクセス設定」のような項目は追加しない)
- **通知 / トースト / モーダル**:
  - BlockEditor アップロード進捗 toast: 既存パターン (`toast.error('動画アップロードに失敗しました', { description })`) 踏襲
  - BlockEditor 動画アップロード時の **Pro プラン未契約警告 toast**: 「Supabase Pro プラン契約後に動画アップロード可能になります」
  - BlockRenderer Signed URL 取得失敗時: スケルトン + 「メディアの取得に失敗しました。再読み込みしてください」(brand-red dashed border)
- **ヘッダー / フッター / パンくず**: 該当なし
- **ロール別の表示差異**:
  - admin: 全機能アップロード/閲覧可
  - manager: 自施設のみアップロード/閲覧可
  - employee: 閲覧のみ
  - **退職 (status='retired')**: 全ロール全機能でメディアアクセス停止(発行 API 403)
- **モバイル時の表示**:
  - 動画: ネイティブ `<video>` で再生(iOS Safari `playsInline` 必須)
  - PDF: iframe inline 表示が崩れる場合は ▶「PDF を開く」ボタンに fallback
  - 画像: `<img>` をそのまま

---

## 4. 連動更新ポイント

- **`ContentBlockJson` の型変更** → `lib/types.ts:585` + `components/admin/BlockEditor.tsx:13` + `components/admin/BlockRenderer.tsx` の分岐ロジック + 各機能ページ (`app/(admin)/admin/{manuals,trainings,announcements,compliance}/page.tsx` の保存ロジック) + employee 側ページ (`app/(employee)/my/{manuals,trainings,announcements,compliance}/...`)
- **新規 Signed URL 発行 RPC** → `supabase/migrations/211_signed_media_rpc.sql` + `scripts/apply-migration-211.mjs` + `docs/migration-applied.md` + `docs/reference-map.md`
- **`documents` バケット SELECT/ALL RLS に `status='active'` 条件追加** → `supabase/migrations/210_active_only_documents_rls.sql` + `scripts/apply-migration-210.mjs` + `scripts/snapshot-storage-policies.mjs` 再実行 + `docs/storage-policy-snapshot.json` + `docs/migration-applied.md` (CLAUDE.md §16-3 義務)
- **動画 file_size_limit 引上げ** → `supabase/migrations/212_documents_bucket_size_limit.sql` + snapshot 再取得 + `docs/constraints.md` §1 にプラン値併記
- **BlockEditor 動画/PDF アップロード UI 追加** → `components/admin/BlockEditor.tsx` + `lib/upload-helpers.ts` (動画用 buildStoragePath prefix 確認)
- **BlockRenderer Signed URL 都度取得** → `components/admin/BlockRenderer.tsx` + `lib/hooks/useSignedMediaUrl.ts` (新規) + `package.json` (swr が依存にあるか要確認、無ければ追加)
- **既存 Drive 動画/PDF 一括移行** → `scripts/migrate-drive-to-storage.mjs` (新規) + 実行手順を `docs/migration-applied.md` の運用フローセクションに追加 + Drive 側ファイル削除手順を delivery checklist 化
- **既存画像 10 年 Signed URL バックフィル** → `scripts/backfill-image-signed-urls.mjs` (新規) + `manuals/trainings/announcements/compliance_items` 4 テーブルの content_blocks 行を全て走査して URL → storage_path 変換 + `content_blocks` JSON 上書き UPDATE
- **退職フラグ伝播の仕様明示** → CLAUDE.md §9 にメディアアクセス遅延仕様 (最大 60 分) を追記
- **既存 BlockEditor 画像アップロードの 10 年 → 10 分 TTL 変更** → `components/admin/BlockEditor.tsx:82` の `createSignedUrl` を撤去 → `storage_path` のみ保存し表示時に都度発行
- **error-log.md 過去エントリ更新** → 2026-05-26「Drive 動画 proxy 撤去」エントリに「退職後アクセス問題は本仕様で構造解決」追記
- **constraints.md §1 関連 case 追記** → 「2026-05-26 本仕様で短期 Signed URL + active 判定モデル採用」を追記

---

## 5. ロール別権限マトリクス

| 操作 | 管理者 (admin) | マネージャー (manager) | 一般 (employee) | 退職者 (status='retired') |
|---|---|---|---|---|
| 動画/PDF/画像 アップロード (BlockEditor) | ◯ | ◯ (自施設のみ) | × | × |
| メディア閲覧 (Signed URL 発行) | ◯ | ◯ | ◯ | **×** (RPC で `status='active'` 強制) |
| アップロード済みメディア削除 | ◯ | ◯ (自施設のみ) | × | × |
| 移行スクリプト (`scripts/migrate-*.mjs`) 実行 | ◯ (ローカル/CI のみ) | × | × | × |

> 退職時の伝播は最大 TTL 遅延(動画 60 分 / 画像 10 分) → 仕様として明示。即時遮断は不可能(キャッシュ済み Signed URL を持つクライアントは TTL 切れまで再生可)。

---

## 6. 既存機能との差分・依存

- **似た機能の有無**:
  - 既存: BlockEditor は画像のみ Supabase Storage `documents` バケットにアップロード(`createSignedUrl(path, 10年)` で URL を直保存)
  - 本仕様: それを動画/PDF にも拡張 + TTL を 10 年から 10〜60 分に短縮 + 表示時都度発行モデル
  - **増やすのは UI と発行 API のみ。Storage バケット / 認証は既存資産流用**
- **依存する既存機能・モジュール**:
  - `lib/upload-helpers.ts` (buildStoragePath / sanitizeFilename) — そのまま使用
  - `lib/supabase/client.ts` (browser SDK)
  - `documents` Storage バケット — 既存。`file_size_limit` だけ引上げ
  - `employees.status` + `EMPLOYEE_STATUS` 定数 — 既存 `['active','retired']`
  - `swr` — 依存に無ければ追加(要確認)
- **この変更で影響を受ける既存機能**:
  - **マニュアル / 研修 / お知らせ / 遵守事項 の表示**(BlockRenderer 経由全部)
  - **BlockEditor 画像アップロード**(10 年 → 10 分 TTL 変更で既存画像は移行対象)
  - **`documents` バケット**(RLS 強化 + file_size_limit 引上げ)
  - **PWA / モバイル**(動画再生方式変更 → 実機確認必須)

---

## 7. 実装ルール

- **命名規則**:
  - RPC: `request_signed_media_url` (snake_case)
  - API ルート: `app/api/storage/sign/route.ts` (kebab-case)
  - hook: `useSignedMediaUrl` (camelCase)
  - 移行スクリプト: `scripts/migrate-drive-to-storage.mjs` / `scripts/backfill-image-signed-urls.mjs` (kebab-case)
  - Storage prefix: 既存通り `{compliance|trainings|announcements|manuals}/{tenantId}/...`
- **再利用すべき既存コンポーネント**:
  - `lib/upload-helpers.ts` の `buildStoragePath` / `sanitizeFilename`
  - BlockEditor の `handleImageUpload` 構造(setUploading / try-finally / toast)を `handleVideoUpload` / `handlePdfUpload` にコピー
  - エラー時 toast: `toast.error('〜に失敗しました', { description: error.message })`
  - 移行スクリプトは既存 `scripts/apply-migration-NNN.mjs` の pooler 接続パターンを踏襲([reference_supabase_pooler.md](C:/Users/2han2/.claude/projects/C--Users-2han2-Projects-deaf-ic/memory/reference_supabase_pooler.md) 参照)
- **使用デザイントークン**:
  - 色: `brand-blue` / `brand-ink` / `brand-gray` / `brand-gray-light` / `brand-red`
  - スケルトン: `bg-brand-gray/10 animate-pulse`
  - 再試行ボタン: `border-brand-red/30 text-brand-red hover:bg-brand-red/5`
- **モバイル対応方針**:
  - 動画 `<video playsInline>` 必須
  - PDF iframe が崩れる端末では「📁 PDF を開く」ボタン (新タブ) を fallback として残す
  - レイアウトブレークポイントは既存通り (Tailwind default sm/md/lg)

---

## 8. 完成条件

- **正常系チェック**:
  1. admin で動画 mp4 (10 MB / 50 MB / 200 MB 境界 各サイズ) を BlockEditor からアップロード → DB に `storage_path` 保存 → 再ロードで再生
  2. manager (自施設) が同操作可能
  3. employee で BlockRenderer から再生(TTL 60 分 → 50 分時点で自動再フェッチ)
  4. PDF も同様
  5. **既存 Drive 動画/PDF が全件移行完了**して BlockRenderer で再生できる
  6. **既存 10 年 Signed URL 画像が全件 `storage_path` に変換**されて表示できる
- **異常系チェック**:
  - 退職フラグを立てた employee で発行 API → 403 + 「現在ご利用いただけません」エラー表示
  - 他テナントの storage_path → 403 (RLS で弾く)
  - 非対応 MIME (svg / heic 動画 / mov 等) → アップロード拒否
  - file_size_limit 超過 → アップロード拒否
  - **未認証で発行 API** → 401
  - **TTL 切れ後の URL 直アクセス** → 403 (Supabase 側で expire)
- **境界値チェック**:
  - file_size_limit ちょうど → 受領
  - +1 バイト → 拒否
  - TTL 切れ直後 (60 分 + 1 秒) → SWR 再フェッチで自動復活
- **ローカル確認項目 (`npm run dev`)**:
  1. `/admin/manuals/new` で動画/PDF/画像 アップロード → 保存 → `/my/manuals/[id]` で再生/表示
  2. Supabase SQL Editor で対象 employee の `status='retired'` に変更 → 再ロード → 全メディア再生不可
  3. 移行スクリプトを dry-run → 実行件数と容量見積もりが妥当
  4. 移行スクリプトを本番実行(Pro プラン契約後) → 既存 Drive リンクが全件 `storage_path` に置換され、表示が継続
  5. Drive 側ファイル削除(or 共有解除)後、旧 Drive URL に直アクセスして 404
- **移行スクリプト dry-run チェックリスト**:
  - 対象テーブル: `manuals` / `trainings` / `announcements` / `compliance_items` 4 テーブル
  - 対象行数の集計 + 動画/PDF/画像の内訳 + 合計容量見積もり
  - Drive 側 fileId 一覧 + 公開設定確認 (private なら手動対応リスト出力)
  - Pro プラン Storage 100 GB 枠に対する充足率
- **将来対応として分離するもの**:
  - employee-images バケットの同様の active 判定追加
  - 監査ログテーブル (`storage_access_logs`)
  - 動画のサーバサイド圧縮 / Cloudflare Stream 移行
  - Storage 容量逼迫時の自動クリーンアップ
  - 退職時に即座 Signed URL 無効化 (Supabase Storage は Signed URL の revoke API がないため、別ストレージ層への移行検討)

---

## 9. 前提条件と段取り

本仕様の実装は以下の順序で進める。**Phase 1 完了 = Pro 契約完了**まで Phase 2 以降に進まない。

### Phase 0: 事前調査(本仕様承認後すぐ)

1. `scripts/probe-content-media-volume.mjs` を新設し、現状の Drive 動画/PDF/画像の件数 + 推定容量を出す
2. Supabase Pro プラン契約に必要な情報をユーザーに提示

### Phase 1: Supabase Pro 契約 + 前提構築

1. ユーザー側で Supabase Pro 契約完了
2. `supabase/migrations/210_active_only_documents_rls.sql` 適用
3. `supabase/migrations/211_signed_media_rpc.sql` 適用
4. `supabase/migrations/212_documents_bucket_size_limit.sql` 適用
5. `scripts/snapshot-storage-policies.mjs` 実行 → `docs/storage-policy-snapshot.json` 更新

### Phase 2: API + UI 実装

1. `app/api/storage/sign/route.ts` 新設
2. `lib/hooks/useSignedMediaUrl.ts` 新設
3. `components/admin/BlockRenderer.tsx` 改修(Drive 分岐撤去 → storage_path 経由)
4. `components/admin/BlockEditor.tsx` 改修(動画/PDF アップロード UI 追加 + 画像 10 年→storage_path 化)
5. `lib/types.ts` の `ContentBlockJson` 更新
6. `npm run dev` で新規アップロードフローと既存 Drive リンク互換描画を確認

### Phase 3: 既存データ移行

1. `scripts/migrate-drive-to-storage.mjs` 新設 + dry-run
2. dry-run 結果をユーザー承認
3. 本番実行(進捗バー + ロールバック手順)
4. `scripts/backfill-image-signed-urls.mjs` 実行(既存画像 storage_path 化)
5. 全機能 (`/my/manuals`, `/my/trainings`, `/my/announcements`, `/my/compliance`) で表示確認

### Phase 4: Drive 側ファイル削除 + 仕上げ

1. 移行成功 7 日後(運用安定期間)に Drive 側ファイル「リンクを知ってる全員」設定を解除 or 物理削除
2. `docs/error-log.md` に「退職後アクセス問題」エントリ追加(解決済)
3. `docs/constraints.md` §1 関連 case 追記
4. `docs/migration-applied.md` 完了記録

---

## 10. リスクと緩和策

| リスク | 緩和策 |
|---|---|
| Pro 契約コスト($25/月)を NPO が継続負担できるか | Phase 0 調査で実容量を出して年額試算を提示。Free 継続では本仕様実現不可と明示 |
| 動画 60 分 TTL でも長時間動画は再生途中で切れる | 1 動画あたり最大 60 分の業務的制約を明示。長尺動画は分割アップロード推奨 |
| 移行スクリプト中の Drive ダウンロード失敗 | dry-run で fileId 全件アクセス確認 + 失敗行のリトライ + マニュアル再アップロード手順を script 内に出す |
| 移行中の DB 行の整合性 | トランザクション単位で `content_blocks` 更新 + 移行前 snapshot を `docs/migration-snapshots/` に JSON 保存 |
| Supabase Storage の Signed URL を退職前にコピーしてた場合 | 動画 60 分 / 画像 10 分の TTL で必ず期限切れ。バックエンドで revoke は不可能(構造的限界として受容) |
| iOS Safari で PDF iframe inline 表示が崩れる | `Content-Disposition: inline` + 「PDF を開く」ボタン併設で逃げる |

---

> 本ドラフトの承認をもって Phase 0(事前調査スクリプト作成 + 実行)に着手する。
> Phase 0 結果を見てから Phase 1 以降の本格実装に進む(Pro 契約は Phase 0 結果を踏まえてユーザー判断)。
