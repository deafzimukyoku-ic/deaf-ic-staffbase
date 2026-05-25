 # CLAUDE.md — deaf-ic（認定NPO法人名古屋ろう国際センター向け統合シフト・社員管理アプリ）

## 1. プロジェクト概要

- **アプリ名**: deaf-ic
- **納品先**: 認定NPO法人名古屋ろう国際センター（配下事業所 現時点4箇所）
- **目的**: 旧 `diletto-shift-maker`（シフトパズル・送迎管理）と旧 `diletto-staffbase`（社員管理・書類・研修・お知らせ・AI診断）を**1アプリ・1Supabase・1デプロイ**に統合してNPOに納品する。
- **参照元** (2026-05-19 統合完了に伴いローカル削除済 / 必要なら GitHub から再 clone 可能):
  - `https://github.com/2han2be4han/diletto-shift-maker` (旧シフトパズル)
  - `https://github.com/2han2be4han/diletto-staffbase` (旧社員管理)
- **統合方針**: staffbase をベースに shift-maker を facility 対応で取り込む（Option 1）

### 技術スタック（staffbase ベースを踏襲）
- Next.js 16 (App Router) / React 19 / TypeScript
- Tailwind CSS 4 + shadcn/ui
- Supabase（PG + Auth + Storage + RLS）
- Anthropic Claude API（PDF解析 `claude-sonnet-4-20250514` + AI診断 `claude-haiku-4-5`）
- pdf-lib / @pdf-lib/fontkit / fabric.js / pdfjs-dist / JSZip
- @fullcalendar/react / @dnd-kit / date-fns / date-fns-tz
- Vercel デプロイ

### 削除・改変する既存機能
- **Stripe関連** 完全削除（課金不要）
- **super_admin ロール** 完全削除（3段階 admin / manager / employee に統一）
- **デモモード**（shift-maker の `sp_demo` cookie / DEV_SKIP_AUTH）完全削除
- **マルチテナント**は1テナント固定（NPO本部）、配下事業所は `facilities` で表現
- **事業所単位の機能 ON/OFF**は `facilities` テーブルのフラグで制御:
  - `shift_enabled` — false なら事業所セレクタからも除外（本部など）（migration 116）。**設定 UI のトグルは「シフトのみ」と紛らわしいため削除済み**。デフォルト true で運用、本部除外が必要なら DB 直接更新
  - `transport_enabled` — false なら送迎表ナビ + 送迎関連 UI を非表示（migration 116）
  - `shift_only_mode` — true なら利用表 / 送迎表 / 日次出力 / 業務日報 / 事業所設定 / 児童管理 を sidebar から除外し、ダッシュボード + シフト表 + 休み希望 + 職員管理 のみ表示（migration 125）
- これらは事業所ごとに独立。テナントレベルの機能 ON/OFF は持たない（1 テナント固定運用のため）。
- **デザインは現 staffbase をそのまま維持**。完成後に**ロゴ・アイコン・アプリ名のみ差替**（deaf-ic.org風デザイン適用はしない）

---

## 2. 開発フロー（固定・省略禁止）

1. **いきなり実装禁止**。調査 → 計画 → 承認 → 実装 の順
2. **デプロイは最小限**。必ず `npm run dev` で動作確認してから次へ
3. 新機能着手前に「影響範囲・依存ファイル・連動ポイント」を文書化
4. **実装着手前に `docs/progress.html` を作成/更新してユーザー承認を得る**
5. 新技術・ライブラリ使用前に既知の地雷・注意点を調査してユーザーに提示
6. 詰まりそうなポイントは実装前にユーザーへ事前報告
7. 想定外の挙動が発生したら勝手に解決せず即報告
8. **両参照元アプリ (`diletto-shift-maker/`, `diletto-staffbase/`) を直接変更しない**。参照のみ。

---

## 3. 進捗表の運用（docs/progress.html）

実装着手前に作成、ステップ完了ごとに更新。
各ステップに「別視点確認」項目を必ず加える。

含める項目:
- フェーズ名 / 機能名 / 対象ファイル名 / ステータス（未着手／進行中／完了）/ 完了率（%）/ 備考

更新忘れ = 作業未完了とみなす。

---

## 4. ロール設計（3段階）

| ロール | 範囲 | シフトパズル |
|---|---|---|
| **admin** | NPO全事業所の全機能、tenant設定、事業所追加、ロール変更 | ✅ 全事業所 |
| **manager** | 所属事業所のみの全機能、employee画面への切替可 | ✅ 自事業所のみ |
| **employee** | 自分の情報のみ（自シフト閲覧・休み希望提出・書類・研修・お知らせ） | ❌ 不可 |

- `employees.role` enum: `admin` / `manager` / `employee`
- `employees.facility_id` で所属事業所を紐付け
- RLS: manager は `facility_id = auth のemployees.facility_id` のみ操作可、admin はスコープ無制限

---

## 5. データモデル（要点）

```
tenants (1行固定: NPO本部)
  └─ facilities (4行 seed: 現時点の4事業所)
       └─ employees (facility_id で所属紐付け)
```

- `tenants` は固定1行。将来の多法人展開も構造上は可能（納品時は1行固定運用）
- `facilities` に全事業所。事業所単位で機能 ON/OFF が可能（`shift_enabled` / `transport_enabled` / `shift_only_mode`、上記§1参照）
- shift-maker 由来のテーブル（`children`, `schedule_entries`, `shift_requests`, `shift_assignments`, `transport_assignments` 等）は全て `facility_id` カラム追加 + RLS を facility 単位に改造

### シフト公開フロー（Phase 5 要件）
`shift_assignments.publish_status` enum:
- `draft` … 編集中（employee 非表示）
- `ready` … 作成完了・社内レビュー用（manager / admin のみ）
- `published` … 公開（employee が自分の分を閲覧可能）

`transport_assignments` も同じ `publish_status` に連動。
employee 側 RLS: `publish_status='published'` かつ `staff_id=auth.uid()` のみ SELECT 可。

---

## 6. ディレクトリ構成（統合後）

```
deaf-ic/
├── app/
│   ├── (auth)/login, reset-password
│   ├── (employee)/my/
│   │   ├── shifts/           ... 自シフト閲覧（published のみ）
│   │   ├── requests/         ... 休み希望提出
│   │   ├── documents/        ... (staffbase 既存)
│   │   ├── trainings/
│   │   ├── announcements/
│   │   ├── compliance/
│   │   └── profile/
│   ├── (manager)/admin/
│   │   ├── dashboard/
│   │   ├── employees/        ... 社員管理
│   │   ├── facilities/       ... 事業所管理（admin のみ）
│   │   ├── shifts/
│   │   │   ├── schedule/     ... 利用予定（PDF取込）
│   │   │   ├── shift/        ... シフト作成・公開
│   │   │   └── transport/    ... 送迎表
│   │   ├── requests/         ... 休み希望承認
│   │   ├── documents/
│   │   ├── trainings/
│   │   ├── announcements/
│   │   ├── compliance/
│   │   └── settings/
│   ├── api/
│   └── layout.tsx
├── components/
│   ├── ui/                   ... shadcn/ui（変更禁止）
│   ├── branding/Logo.tsx, Footer.tsx
│   ├── shift/, schedule/, transport/, request/
│   ├── admin/, employee/ (staffbase 既存コンポーネント)
├── lib/
│   ├── supabase/
│   ├── auth/guards.ts        ... requireRole, requireFacility
│   ├── logic/generateShift.ts, generateTransport.ts
│   ├── pdf/, anthropic/, ai-prompts.ts, ai-client.ts
│   ├── constants.ts
│   └── types.ts
├── supabase/migrations/      ... 統合マイグレーション
├── public/fonts/, logo.svg
├── middleware.ts             ... ロール別ルート保護
├── docs/
│   ├── progress.html
│   ├── reference-map.md
│   └── error-log.md
├── CLAUDE.md
├── SPEC.md
├── .env.example
└── README.md
```

---

## 7. 編集ルール

### 変更可
- app/ 配下の新規追加・既存ページの修正
- components/admin|employee|branding|shift|schedule|transport|request 配下
- lib/pdf, lib/logic, lib/supabase 新規追加・修正
- lib/types.ts（型追加。既存削除は承認必須）
- supabase/migrations 新規追加のみ
- public/ 静的ファイル追加

### 変更禁止
- components/ui/*（shadcn 標準）
- lib/constants.ts（承認必須）
- lib/ai-prompts.ts（マスタープロンプト改変禁止）
- 既存マイグレーション（一度適用したもの）
- 参照元アプリ (`diletto-shift-maker/`, `diletto-staffbase/`) — 直接編集しない

### 新機能追加時の必須手順
1. 影響範囲・依存ファイル・連動ポイントを文書化
2. `docs/progress.html` に追加
3. `docs/reference-map.md` を更新
4. ユーザー承認を得る
5. 実装 → `npm run dev` 動作確認
6. `docs/progress.html` 完了に更新

### 破壊的変更の禁止
- `tenant_id` / `facility_id` カラムのないテーブル作成禁止（facilities・tenants 自身を除く）
- RLS ポリシー未設定でのテーブル公開禁止
- `publish_status='published'` のシフトを自動上書き禁止（明示的な再公開フロー）
- `is_confirmed=true` レコードの自動上書き禁止
- LibreOffice 導入禁止 / AI診断結果の employee 閲覧禁止 / 電子署名禁止
- PPTX アップロード禁止（PDF のみ）
- タグのフォントファミリーは IPAex 明朝 固定（IPA Font License v1.0 で同梱、MS 明朝相当）
- タグの装飾機能（太字/斜体/下線/色/回転）禁止

### メール HTML 編集ルール (binding)
- `lib/email/*.ts` を変更する場合は **編集前に必ず `docs/mail-design-rules.md` を読む**
- ブランド表記 (`認定NPO法人 名古屋ろう国際センター`) / 色 (`#4169e1`) / 骨格 (canonical HTML) を完全一致させる
- 「いい感じ」「適当に」等のあいまい表現で実装してはならない (= 本ドキュメントの違反)
- deaf-ic 側に `diletto`, `diletto-s.com` 等の他ブランド要素を書いた瞬間に違反
- 詳細は `docs/mail-design-rules.md` §1〜§7 を参照

---

## 8. ハードコード制約（constants.ts）

staffbase ベース:
- `MAX_DOCUMENTS_PER_TENANT=10`
- `MAX_PAYROLL_BANKS_PER_TENANT=3`
- `MAX_AI_DIAGNOSIS_PER_MONTH=30`
- `MAX_PDF_FILE_SIZE_MB=20`
- `TRAINING_SUMMARY_MIN_CHARS=300`
- `AI_MODEL='claude-haiku-4-5'`（AI診断）
- `PDF_PARSE_MODEL='claude-sonnet-4-20250514'`（PDF解析、shift-maker 由来）
- `FONT_SIZES=[8,10,12,14,16,18,20,24,28,32,36,48]`
- `DEFAULT_FONT_SIZE=10`
- `FONT_FAMILY='IPAex Mincho'`（固定。`public/fonts/IPAexMincho-Regular.ttf` を埋め込み）
- `PDF_ASCENT_RATIO=0.76`
- `MAPPING_SOURCE_TYPES: employee|tenant|form_data|fixed|custom_field`
- `INPUT_TYPES: text|textarea|date|number|select`
- ~~`VISIBILITY_CONDITIONS`~~ migration 119 で廃止。書類の必須/任意・対象者は `lib/field-applicability.ts` の `CORE_FIELD_GATES` + `custom_employee_fields.gate_fields` から **タグの required + source_field** に基づき自動判定（`lib/document-applicability.isDocumentApplicable`）
- `TRAINING_RESULT: pending|passed|failed|resubmit`
- `ROLES: admin|manager|employee`
- `PUBLISH_STATUS: draft|ready|published`
- `ATTENDANCE_STATUS: planned|present|absent|late|early_leave`

shift-maker 由来:
- `MAX_STAFF_PER_TRANSPORT=2`
- `DEFAULT_MIN_QUALIFIED_STAFF=2`
- `TRANSPORT_TRIP_GAP_MINUTES=30`

利用料金表 (Phase 66, migration 126〜):
- `SNACK_FEE_PER_DAY=50`（おやつ消耗品代、円/日、固定）
- 公文代: 児童ごとに `children.kumon_monthly_fee`（円、自然数、null=計上しない）。施設・児童で金額を変えられる
- `COPAY_TIERS=['zero','4600','37200','freeform']`
- `NAGOYA_FREE_PRESCHOOL_MUNICIPALITY='名古屋市'`（preschool も無償化対象になる市）
- `FREE_GRADES_NATIONWIDE=['nursery_3','nursery_4','nursery_5']`（全国無償化対象）
- 利用負担額の精緻計算（出席日数 × 単価でクリップ等）はデイロボに任せ、月次料金表ページで手動入力。child 属性として 1日単価は持たない

削除された定数: `PLAN_NAMES`, `PLAN_LIMITS`, `PLAN_PRICES_JPY`（Stripe削除のため）

---

## 9. 実装時の必須ルール

### コード品質
- 本番コードに `console.log` を残さない
- TypeScript で `any` 使用禁止
- コメントは「なぜ」を書く（「何を」は書かない）
- エラーハンドリング省略禁止
- ユーザー向けエラーメッセージは日本語

### セキュリティ
- APIキー・シークレット直書き禁止
- `.env.local` は `.gitignore` 必須
- `.env.example` に項目名のみ
- `SUPABASE_SERVICE_ROLE_KEY` ブラウザ露出禁止
- `NEXT_PUBLIC_` にシークレット禁止

### アクセシビリティ（ろう者向け納品のため必須）
- **音声通知を一切使わない**。全通知は視覚（トースト/バッジ/色/アイコン）
- 色のみで情報を伝えない（色＋アイコン＋テキストの併用）
- フォームエラーは入力欄の直下に日本語で明示
- キーボード操作のみで全機能到達可能

### 動作確認
- 正常系 + 異常系（空・上限・エラー）を確認
- PC・タブレットで表示確認
- `npm run dev` 確認後に報告

---

## 10. 機能ごとの制約

### PDF解析（Claude API）
- `claude-sonnet-4-20250514` 固定
- `max_tokens=4000`
- レスポンス必ずJSON
- 解析結果は確認画面経由でDB保存（直接保存禁止）
- APIキー未設定時はUIで手動入力にフォールバック

### シフト生成ロジック
- 最低出勤人数: `max(ceil(利用人数/2), 3)`
- 有資格者最低: tenant/facility 設定値（デフォ2名）
- 生成結果は `publish_status='draft'` で保存
- `publish_status='published'` の月は明示再公開なしに上書き禁止

### 送迎担当割り当て
- 1送迎につき最大2名
- 優先ルール: ①出勤者 ②勤務時間内 ③エリア一致 ④30分以内なら同便 ⑤トリップ均等分散
- 条件未達は `is_unassigned=true` + 赤ハイライト（空欄確定禁止）
- 全事業所で利用可能（ON/OFF切替なし）

### シフト公開フロー
- `draft → ready → published` の順で遷移
- 「作成完了」ボタン = `draft → ready`
- 「公開」ボタン = `ready → published`（確認モーダル）
- 公開後編集は差分警告 → 再公開フロー
- employee 側 RLS は `publish_status='published'` のみ

### 権限制御
- ロールチェックはAPI側で必ず実施（フロントのみ制御禁止）
- `employee`: 自分の `shift_requests` 書き込み可、自 `shift_change_requests` 書き込み可、出欠 RPC `update_schedule_entry_attendance` 可
- `manager`: 自 facility 内の全書き込み可（他 facility 禁止）
- `admin`: 全操作可。シフト変更申請承認は出勤中 admin のみ

### 出欠記録
- `schedule_entries.attendance_status`: `planned|present|absent|late|early_leave|leave|waitlist`
- 更新は RPC `update_schedule_entry_attendance(p_entry_id, p_status, p_waitlist_order)` 経由（migration 124 で 第3引数追加）
- `attendance_audit_logs` に status 変更時のみ履歴記録（changed_by_name スナップショット）
- **deaf-ic 出席判定（一元化・Phase 66-E 以降）**: `lib/logic/attendance.ts` の `isAttended()` を全箇所で使用。
  - 判定式: 「`pickup_time` または `dropoff_time` が入っている」かつ「`attendance_status !== 'waitlist'`」
  - `absent` / `leave` を選ぶと UI で時刻が NULL に強制されるため、status による明示除外は不要（時間 NULL で自動的にカウント外）
  - `planned + 時間あり` は自動で出席扱い（PDF インポート直後でカウントされる）
  - 時間 NULL の `planned` / `present` エントリ（attendance status だけ作られた空セル）はカウントされない
  - 利用表モーダルから「出席」ボタンは削除済。明示マークは「お休み / 欠席 / キャンセル待ち」の 3 つのみ（再押下でトグル解除）
  - `present` ステータスは互換のため enum に残置。時間ありなら出席扱いに該当
  - 利用箇所: `BillingFull` / `DailyOutputFull` / `ShiftFull` / `WeeklyTransportFull` / `TransportFull` / `StaffChildOverlapView` / `generateShift`
  - 送迎表 (`TransportFull`) のみ「キャンセル待ちセクション表示用」に `isWaitlist()` も併用（出席扱いではない）
- `waitlist` 児童は日次出力・送迎表（メイン）・シフト生成・利用料金表 出席日数 から除外

### AI診断
- `claude-haiku-4-5` 固定
- `MAX_AI_DIAGNOSIS_PER_MONTH=30` 上限
- APIキー未設定時は機能非表示（エラーにしない）
- 診断結果は employee 画面に出さない（admin/manager のみ）

### PDFテンプレート / タグ配置 / 差し込み生成
- staffbase の既存仕様を踏襲
- IPAex 明朝 固定（MS 明朝相当）/ エディタのタグ表示は `|__○○__` プレーンテキスト形式
- 1テンプレートあたり同tag_keyは1つまで（UNIQUE）
- 座標: PDF points 左上原点、変換時 `y = pageHeight - yFromTop - (fontSize × 0.76)`

---

## 11. 命名規則

| カテゴリ | 規則 | 例 |
|---|---|---|
| ファイル | kebab-case | `generate-shift.ts` |
| Component | PascalCase | `ShiftGrid` |
| 関数・変数 | camelCase | `generatePdf` |
| 型 | PascalCase | `TagPlacement`, `EmployeeRow` |
| 定数 | SCREAMING_SNAKE_CASE | `MAX_PDF_FILE_SIZE_MB` |
| DBテーブル | snake_case 複数形 | `shift_assignments` |
| DBカラム | snake_case | `facility_id` |
| APIルート | kebab-case | `/api/shifts/publish` |
| 環境変数 | SCREAMING_SNAKE_CASE | `ANTHROPIC_API_KEY` |
| タグキー | snake_case | `last_name` |
| ロール文字列 | 定数経由 | `ROLES.admin` |

---

## 12. 連動ポイント

| 変更箇所 | 確認が必要なファイル |
|---|---|
| `lib/types.ts` 型変更 | 該当型を使用する全箇所 |
| `lib/constants.ts` 変更 | middleware.ts + 全参照箇所 + `docs/reference-map.md` |
| DBテーブル構造変更 | `lib/types.ts` + 該当API + コンポーネント + `reference-map.md` |
| `generateShift.ts` 変更 | `/api/shifts/generate` + `ShiftGrid.tsx` |
| `generateTransport.ts` 変更 | `/api/transport/generate` + `TransportDayView.tsx` |
| ロール/権限変更 | 全APIのロールチェック + `reference-map.md` ロール参照セクション |
| `facility_id` 関連 | 全 facility-scoped テーブルの RLS + `reference-map.md` |
| `publish_status` 関連 | shift/transport APIs + `ShiftGrid.tsx` + `TransportDayView.tsx` + employee 側RLS |
| Supabase テーブル追加 | RLS 設定 + `types.ts` + `reference-map.md` |
| `ai-prompts.ts` | そのファイルのみ |

---

## 13. スコープ外（実装禁止）

- 複数テナント運用UI（納品時は1テナント固定）
- 電子署名 / 電子契約 / SSO / MFA / 多言語 / モバイルアプリ
- LibreOffice サーバー導入
- AI診断結果の employee 閲覧
- PDF上の画像配置（印鑑・写真）
- PPTX アップロード
- 保護者向けポータル
- デイロボ自動ログイン（利用規約確認後に別フェーズ）
- タグの装飾機能（太字/斜体/色/回転）
- 送迎担当の完全自動確定（必ず人間確認）
- 音声通知

---

## 14. 参照マップ運用（docs/reference-map.md）

プロジェクト内の「カラム・定数・型・テーブル・ロール」の参照台帳。

必ず守ること:
1. 新規ファイル作成時: 参照している DBカラム・ロール名・定数・型を追記
2. 既存ファイル編集時: 該当エントリを更新
3. DBカラム追加時: 着手前に reference-map に追記
4. ロール変更前: ロール参照セクションを確認してユーザーに報告
5. 更新忘れ = 作業未完了

---

## 15. エラーログ運用（docs/error-log.md）

エラーと解決方法の学習ログ。フォーマット:
```
---
## [エラー名・現象]
- **発生日**: YYYY-MM-DD
- **発生箇所**: ファイル名・関数・行
- **エラー内容**: 実メッセージ
- **原因**:
- **解決方法**:
- **再発防止**:
---
```

必ず守ること:
1. 解決したら作業完了前に記録
2. 同種エラー発生時はまず error-log を参照
3. ユーザー指摘で発覚したエラーも記録
4. 未解決も「未解決」として記録しユーザー報告
5. 記録忘れ = 作業未完了

---

## 16. Supabase Dashboard 直接編集の禁止 / 再発防止フレーム

2026-05-25 の `storage.objects` documents バケット事故 (BlockEditor 画像アップロード全件失敗) を踏まえた永続ルール。
詳細経緯は `docs/error-log.md` の該当エントリと `docs/migration-applied.md` の「既知の不整合」表参照。

### 16-1. Dashboard 直接編集の禁止
- **Supabase Dashboard で policy / RLS / function / trigger / 列を直接編集・追加・削除しない**
- 全ての DB 変更は `supabase/migrations/NNN_*.sql` + 対応する `scripts/apply-migration-NNN.mjs` 経由で行う
- Dashboard 編集が必要に見えた場合は、まずユーザーに報告して migration ファイル経由に切り替える
- これは deaf-ic / origami-staffbase / diletto-new-staffbase の 3 リポ共通ルール

### 16-2. 適用済 migration の追跡
- 本リポジトリには `supabase_migrations.schema_migrations` のような自動追跡テーブルが存在しない
- そのため migration ファイルがあっても本番 DB に流れているとは限らない (118 番の事故が実例)
- 200 番以降は `docs/migration-applied.md` に手動記録する。書いたら必ず流す、流したら必ず記録する
- バグ調査で「migration には fix があるのに直っていない」状況に遭遇したら、まず `scripts/probe-*.mjs` で実 DB の現状を引いて事実確認する。ユーザーの「以前はできていた」記憶を主観のまま信じない

### 16-3. Storage policy 変更前後の snapshot 義務
- RLS / storage policy を変更する**前**に `node scripts/snapshot-storage-policies.mjs` を実行し `docs/storage-policy-snapshot.json` を更新
- 変更**後**にもう一度実行して再度 snapshot を上書き、`git diff docs/storage-policy-snapshot.json` を当該 commit に同梱する
- これにより「いつ・何が・どう変わったか」が PR / commit 単位で追跡可能になる
- snapshot は単一の真の状態 (最新本番) を表す。意図しない diff が出たら Dashboard 手動編集を疑う

### 16-4. RLS 変更時の最小手順
1. `scripts/probe-storage-rls.mjs` (または該当 schema 用の probe) で**現状の policy / RLS を実 DB から取得**
2. `scripts/snapshot-storage-policies.mjs` 実行 → snapshot を git に commit (変更前の状態を残す)
3. migration ファイル作成 (`supabase/migrations/NNN_*.sql`)
4. `scripts/apply-migration-NNN.mjs` 作成 + 実行
5. `scripts/snapshot-storage-policies.mjs` を再実行 → snapshot 更新
6. `docs/migration-applied.md` に行追加
7. 上記すべてを 1 commit で push
