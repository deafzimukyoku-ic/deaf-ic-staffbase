# pwa-push-notifications

> 2026-05-23 起票・承認済 / モードB(新規) / feature-impact-spec

## 1. 機能概要

- **機能名**: pwa-push-notifications
- **目的**: スマートフォンに「ホーム画面追加 → プッシュ通知受信」できる PWA 基盤を導入し、既存のメール送信と**同じ通知数 / 同じトリガー**で Web Push をブラウザ / スマホに配信する
- **スコープ(やる)**:
  - `public/manifest.webmanifest` の新設（アプリ名・アイコン・テーマ色・display=standalone）
  - `public/icons/` にホーム画面用アイコン一式を生成（元データ: `phone_logo.jpg`）
  - `app/layout.tsx` の `<head>` に manifest と apple-touch-icon を出力
  - Service Worker (`public/sw.js`) 配信。`push` / `notificationclick` / `pushsubscriptionchange` を実装
  - クライアントから `push_subscriptions` テーブルへ subscription 保存（VAPID 公開鍵で `subscribe()`）
  - 既存 6 系統のメール送信箇所に Web Push を**並行送信**:
    1. notification_queue digest（announcement / compliance / training / manual）
    2. shift_ready / shift_publish
    3. issued_documents 発行（在籍社員のみ。退職社員は subscription なし）
    4. messages 個別連絡（manager-action 経由含む）
    5. 招待メール、招待再送 → push 対象外（subscription 未登録のため自然除外）
    6. 研修結果通知（合格/不合格/再提出）
  - 通知許可の UI: `/my/profile`（基本情報タブ）最上部に **「スマホ通知」セクション**を追加。説明文 = 「お知らせ・遵守事項・研修・業務マニュアルが公開されたときに通知します。」+ 現端末の状態（「この端末で受信しています」/「この端末では受信していません」/「このブラウザは非対応です」）+ ボタン「オンにする」/「オフにする」
  - VAPID キーを `lib/push/server.ts` で管理し `web-push` ライブラリで配信
- **スコープ(やらない)**:
  - iOS の Safari ホーム画面追加なしでの Push（Apple 仕様で不可。運用案内）
  - ネイティブアプリ化（Capacitor / React Native は別フェーズ）
  - 通知の細分化設定 UI（「お知らせだけ受け取る」等。メールと同じ範囲のため）
  - サイレント Push / オフラインキャッシュ（最小 SW で push 専用）
  - Web Push Analytics（配信成否は `push_subscriptions.last_failed_at` のみ）

---

## 2. 影響範囲(impact-catalog 該当項目のみ)

### 2.1 DB スキーマ追加
- `push_subscriptions` (NEW)
  - `id uuid pk`
  - `employee_id uuid not null fk → employees(id) on delete cascade`
  - `endpoint text not null unique`（ブラウザ毎ユニーク）
  - `p256dh text not null`（公開鍵）
  - `auth text not null`（共有秘密）
  - `user_agent text`
  - `created_at timestamptz default now()`
  - `last_used_at timestamptz`
  - `last_failed_at timestamptz`（410 Gone 等で失効マーク用）
  - **RLS**: 本人 SELECT / INSERT / DELETE のみ。service role でのみ全件 SELECT 可
  - **Migration**: `200_push_subscriptions.sql`（次番）

### 2.2 環境変数追加
- `VAPID_PUBLIC_KEY` (server + browser 両方使うため `NEXT_PUBLIC_VAPID_PUBLIC_KEY` でも公開)
- `VAPID_PRIVATE_KEY` (server のみ。Vercel env)
- `VAPID_SUBJECT` (`mailto:` 形式、Apple PushKit が要求)

### 2.3 npm 依存追加
- `web-push@^3.6.x`（サーバー側 Push 配信）
- `@types/web-push`（dev dep）

### 2.4 platform constraints
- **Vercel Hobby**: 関数実行 60s 上限 → Web Push の 1 件あたり〜500ms 想定。最大 100 社員 × 2 端末 = 200 件 / 1 ジョブ = 100s 超過のおそれ。**そのため `web-push` 呼び出しは Promise.allSettled の並列実行（chunk 25 件並列）にして 60s 以内に収める**。
- **Supabase pg_cron**: 既存 `*/10 * * * *` で `/api/cron/send-notifications` を叩いている。Push 配信も同 cron 内で完結（追加 cron なし）。
- **iOS 16.4+ 仕様**: 「ホーム画面に追加」しないと PWA Push 不可。`/my/dashboard` 初回訪問時に Safari なら案内モーダルを表示（feature/pwa-push-notifications §6 参照）。

---

## 3. 表出箇所マップ(空欄禁止)

| 表出箇所 | 内容 |
|---|---|
| サイドバー/ナビ | 該当なし（通知許可は profile 配下） |
| ダッシュボードのカード | **admin / mgr ダッシュボードに「通知購読 N 名 / 在籍 M 名」カード追加**（将来検討。本フェーズは追加しない） |
| 設定画面 | `/my/profile`（基本情報タブ）の**最上部**（「保存する」ボタン直下、フォーム本体の上）に**「スマホ通知」セクション**を独立カードで配置。タイトル「スマホ通知」+ 説明「お知らせ・遵守事項・研修・業務マニュアルが公開されたときに通知します。」+ 状態テキスト（「この端末で受信しています。」/「この端末では受信していません。」/「このブラウザはプッシュ通知に対応していません。」）+ 右端にボタン（未許可なら「オンにする」/許可済なら「オフにする」）。**画像参考**: 添付された参考画像と完全に同じレイアウト |
| 通知/トースト/モーダル | 購読成功 → toast「この端末で通知を受け取れるようになりました」/ 失敗 → toast(エラー文言) |
| ヘッダー/フッター/パンくず | 該当なし |
| ロール別表示差 | admin / manager / employee 全員に同じ UI（自分の subscription のみ管理）。**shift_manager** も同じ |
| モバイル時 | iOS Safari かつ standalone でない場合は profile セクション上部に黄色アラート「iOS では『ホーム画面に追加』後にこの画面から通知を許可してください」を表示。Chrome Android はそのまま許可ボタンが押せる |

---

## 4. 連動更新ポイント(空欄禁止)

| トリガー | 連動して触るファイル / 関数 |
|---|---|
| [新規追加] manifest 配信 | `public/manifest.webmanifest`、`app/layout.tsx`（`metadata.manifest` + `metadata.appleWebApp`） |
| [新規追加] アイコン配信 | `public/icons/icon-192.png` / `icon-512.png` / `icon-180-apple.png` / `icon-maskable-512.png` / `favicon-32.png`（`phone_logo.jpg` を sharp で resize 生成） |
| [新規追加] Service Worker | `public/sw.js`（`push` / `notificationclick` / `pushsubscriptionchange` を実装）、`app/sw-register.tsx`（クライアントサイド登録、`app/layout.tsx` に `<SWRegister />` 配置） |
| [新規追加] 購読 UI | `components/profile/PushSubscriptionSection.tsx`、`app/(employee)/my/profile/page.tsx`（セクションに mount） |
| [新規追加] 購読保存 API | `app/api/push/subscribe/route.ts`（POST: subscription 保存）、`app/api/push/unsubscribe/route.ts`（DELETE: endpoint で削除） |
| [新規追加] サーバー側送信 helper | `lib/push/server.ts`（`sendWebPushToEmployees(employeeIds, payload)`、web-push の `sendNotification` ラッパー、410 で `last_failed_at` 記録 + 自動削除） |
| [新規追加] 型 | `lib/types.ts` に `PushSubscription` 型追加 |
| [メール送信 1] notification_queue digest | `app/api/cron/send-notifications/route.ts` `processTenantDigest` 内、`resend.batch.send` の直後に `sendWebPushToEmployees(itemsByEmployee の key 配列, {title, body, url})` を追加（社員ごと 1 通の digest と同タイミング・同件数） |
| [メール送信 2] shift_ready / shift_publish | `app/api/cron/send-notifications/route.ts` `processShiftRow` 内、`resend.batch.send` の後に `sendWebPushToEmployees(recipients の employee_id 配列, {title:'シフト確認のお願い' or 'シフトが公開されました', url:'/my/shifts' or '/admin/shifts'})` 追加。**注意**: 現状 `recipients` は `email` だけ持つので `id` も取るよう SELECT 修正 |
| [メール送信 3] 書類発行 | `lib/issued-documents/issue-helper.ts` の `resend.emails.send` 直後に push 並行送信（在籍社員のみ）。退職社員は `subscription なし` で no-op |
| [メール送信 4] messages 個別連絡 | `app/api/notifications/manager-action/route.ts`（resend.emails.send 直後）、**および** メッセージ送信本流 `app/api/messages/...`（要 grep。下記 §6 で確認） |
| [メール送信 5] 招待 | `app/api/employees/invite/route.ts` / `app/api/employees/resend-invite/route.ts` → **対象外**（招待時点で subscription 未登録のため自然に skip。コード変更不要） |
| [メール送信 6] 研修結果 | `app/api/email/training-result/route.ts` の `resend.emails.send` 直後に push 並行送信 |
| [DB] migration 追加 | `supabase/migrations/200_push_subscriptions.sql` |
| [docs] reference-map 追記 | `docs/reference-map.md` §0 マイグレーション表に 200 を追加、§0.x に push_subscriptions 解説節を新設 |
| [env] .env.example | `VAPID_PUBLIC_KEY=` / `VAPID_PRIVATE_KEY=` / `VAPID_SUBJECT=mailto:...` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY=` を追加 |
| [next.config] | Service Worker を `/sw.js` で配信するための `headers` (Service-Worker-Allowed: '/') を追加。manifest の Content-Type も明示 |

---

## 5. ロール別権限マトリクス

| ロール | 自分の subscription 登録 | 自分の subscription 削除 | 他社員の subscription 閲覧 |
|---|---|---|---|
| admin | ○ | ○ | × (service role のみ) |
| manager | ○ | ○ | × |
| shift_manager | ○ | ○ | × |
| employee | ○ | ○ | × |

- API 側で `employee_id = 自分の id` を強制（RLS の `auth.uid()` ベース）
- 配信側は `SUPABASE_SERVICE_ROLE_KEY` を使うため RLS バイパス（既存 cron と同じ）

---

## 6. 既存機能との差分・依存

### 似た機能の有無
- `notifications` テーブル（migration 139 で導入された通知ベル）= **アプリ内通知**。ベルアイコンに溜まる類。**Web Push と統合しない**。理由: notifications は in_app チャネル、push は OS 通知センター。トリガーソースは同じイベントだが配信チャネルが別。
- `notification_queue` = メール用キュー。**Push もここに相乗りさせる**（cron 1 本で digest 配送と同時送信。新規キュー追加なし）。

### 依存先
- Resend（メール）と完全に並行。Resend が落ちても Push は出る / Push が落ちてもメールは出る（Promise.allSettled）。
- VAPID 鍵（`web-push generate-vapid-keys` で 1 度生成して Vercel env に保存）

### この変更で影響を受ける既存機能
- `app/api/cron/send-notifications/route.ts` の `processTenantDigest` / `processShiftRow` 内部に push 呼び出しを追加 → cron 実行時間が伸びる（要監視）
- `processShiftRow` の `recipients` 取得 SELECT に `id` カラムを追加（email だけだったのを id + email に）→ 既存ロジックに影響なし
- `app/layout.tsx` に `<SWRegister />` 追加 → 全画面で Service Worker 登録試行。サポート外ブラウザは silent skip
- 個別連絡（messages）の送信本流: `app/api/messages/[threadId]/route.ts` 等を **実装着手前に grep して確定**（manager-action 以外の送信入り口があるか確認）

---

## 7. 実装ルール

### 命名
- ファイル: kebab-case（`push-subscription-section.tsx` ではなく PascalCase コンポーネントとして `PushSubscriptionSection.tsx`。CLAUDE.md §11 「Component PascalCase」に従う）
- API: `/api/push/subscribe`, `/api/push/unsubscribe`
- DB テーブル: `push_subscriptions` (複数形)
- DB カラム: snake_case (`employee_id`, `endpoint`, `p256dh`, `auth`, `last_used_at`, `last_failed_at`)
- 環境変数: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- Service Worker パス: `/sw.js`（プロジェクトルート配信、`Service-Worker-Allowed: /`）

### 再利用すべき既存コンポーネント
- `Button`, `Card`, `Alert` (shadcn) を流用
- toast は `sonner`（既存 `<Toaster />`）

### design-system トークン
- アラート色: 既存 `bg-amber-50 border-amber-200 text-amber-900`（iOS 案内）
- ボタン: `bg-brand-ink text-white` を踏襲

### モバイル対応方針
- iOS Safari 検出: `/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches`
- 上記が true なら「ホーム画面に追加して開き直してください」案内
- Chrome Android はそのまま subscribe ボタンを active 化

### アクセシビリティ（CLAUDE.md §9）
- 通知許可ボタンは `aria-label` 明示
- 状態変化は toast（視覚通知）。音声通知は OS 側プッシュなので OK（鳴らさず無音通知は OS 側に委ねる、payload に `silent: true` 付けるかは要決定 → ろう者向けにつき **payload に振動パターンを明示**、`silent: true` は付けない[OS デフォルトの視覚 + 振動])

---

## 8. 完成条件

### 正常系
- [ ] `npm run dev` 起動 → Chrome Desktop で `/my/profile` を開き「通知を受け取る」ボタンが見える
- [ ] 「通知を受け取る」を押す → 許可ダイアログ → 許可 → `push_subscriptions` に 1 行 insert される
- [ ] 別タブで `/admin/announcements` から新規お知らせ投稿 → 2h 後（DELAY_HOURS）に Push 通知が届く＋同タイミングでメールも届く（**件数完全一致**）
- [ ] 通知をクリック → `/my/announcements` が開く
- [ ] スマホ Chrome Android で `/my/profile` を開き、許可 → 同様に動く
- [ ] スマホ iOS Safari で `/my/profile` を開き、まず黄色アラート表示 → ホーム画面追加 → 開き直し → 許可ボタン active → 許可 → 動く

### 異常系
- [ ] ブラウザが非対応（'serviceWorker' in navigator が false）→ profile に「このブラウザはプッシュ通知非対応」と表示。エラーにしない
- [ ] 許可拒否 → toast「ブラウザの設定から通知を許可してください」
- [ ] subscription endpoint が古くなり 410 Gone → 配信側で自動削除 + `last_failed_at` 記録（次回 cron で SELECT から除外）
- [ ] VAPID 鍵未設定 → サーバー起動時に warn ログ + Push 機能無効化（メール送信は通常通り続行）
- [ ] Apple WebKit が一部 payload を拒否 → サイズ上限 4096 byte を意識して title / body を切り詰める

### 境界値
- [ ] 同じ社員が 3 端末（PC / iPhone / Android）で許可 → push_subscriptions に 3 行、3 端末すべてに通知
- [ ] 同じ endpoint で 2 回 subscribe → UNIQUE 制約で UPDATE（last_used_at 更新）
- [ ] 退職社員（status='inactive'）→ 配信側 SELECT で除外（既存メール送信と同条件）

### ローカル確認項目
- [ ] `web-push generate-vapid-keys` で生成した鍵を `.env.local` に投入
- [ ] `npm run dev` → Chrome Desktop で完全フロー検証
- [ ] DevTools > Application > Service Workers で `/sw.js` が active
- [ ] DevTools > Application > Manifest が読み込まれている
- [ ] `npm run build` がエラーなく通る
- [ ] cron 手動叩き: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:4003/api/cron/send-notifications` で push 配信 + メール配信の両方が走る

### 将来対応の分離
- 通知の細分化設定（カテゴリ別 on/off）→ 別フェーズ
- ネイティブアプリ化 → 別フェーズ
- Web Push Analytics → 別フェーズ
- スマホからのオフライン操作（PWA Cache API）→ 別フェーズ。本フェーズは Push 専用 SW のみ

---

## 9. 実装メモ（実装後に追記）

(未実装)
