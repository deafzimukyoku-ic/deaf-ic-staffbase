# content-version-tracking

> ステータス: 承認済（2026-05-20）。両 repo（staffbase / deaf-ic）に適用。

## 1. 機能概要

- 機能名: `content-version-tracking`
- 目的: 4カテゴリ（遵守事項 / 研修 / お知らせ / 業務マニュアル）のコンテンツが**編集された後**、過去の閲覧 / 確認 / 合格を「旧版」として扱い、**閲覧レポートとダッシュボード「社員進捗一覧」の集計を一致させる**。
- 解決する不具合: ダッシュボード（`employee_progress` view = migration 185 / `get_my_subordinate_progress` RPC = migration 187）は compliance を `ca.document_updated_at = cd.updated_at` で現版のみカウントするが、閲覧レポート（`components/admin/ReportMatrix.tsx`）は `{category}_view_logs` に1行でもあれば「✓既読」で版を見ない → 書類編集後に +1 のズレ（deaf-ic 実データ: 濱田 / 田中 / 笠江 の 3 名で確認、dash=49 vs report=50 等）。staffbase は compliance 公開 0 件のため現状 gap=0 だがコード・スキーマ完全同一で構造的に同じ。

### スコープ

**やる:**
- migration 188: `announcements` に `updated_at` 列 + BEFORE UPDATE トリガ追加 / `trainings` に `recert_at` 列追加
- migration 189: `employee_progress` view + `get_my_subordinate_progress` RPC の `announcements_read` / `manuals_read` / `trainings_passed` を版考慮に再定義
- 閲覧レポート ReportMatrix を「✓現版 / ⚠旧版 / ✗未読」の 3-way セル表示に拡張
- `/api/reports` の items に `updated_at`（4カテゴリ）+ `recert_at`（研修）を含める
- お知らせ / 業務マニュアルの社員ページ（`my/announcements` `my/manuals`）を版考慮化（編集後は「未読」に戻す + 再閲覧で view_log を記録）
- 研修の編集 UI（admin / manager）に「**この変更で再受講を求める**」チェックボックスを追加 → ON 時のみ `recert_at` を更新
- 両 repo（staffbase / deaf-ic）に同一適用

**やらない:**
- compliance のダッシュボード集計（`compliance_done`）の変更 — 既に版考慮で**正しい**ため無変更
- compliance / manuals の `updated_at` 運用方式の変更 — 現状の app 管理（admin ページが明示セット）のまま
- 書類（`document_templates`）— 版概念を持たず、閲覧レポート対象外
- リマインドメールの送信判定ロジック変更（別フェーズ）
- ダッシュボード UI ファイル（`ProgressDashboard.tsx` / `mgr|admin/dashboard/page.tsx`）の変更 — migration 189 は view / RPC の **列構造を不変**に保つため UI 側変更不要（187 と同じ方針）

### 確定済みのユーザー仕様判断

| 論点 | 決定 |
|---|---|
| 版区別の適用範囲 | 4カテゴリとも、レポート + ダッシュボード両方 |
| `announcements` の `updated_at` 更新方式 | DB トリガ（BEFORE UPDATE）|
| 編集 = 再確認要求の判定 | **研修のみ** admin / manager が編集時にチェックで選択。compliance / お知らせ / マニュアルは「編集 = 必ず再確認 / 再読」固定 |

---

## 2. 影響範囲

### データ層

1. **DB スキーマ（migration 188 — 新規）**
   - `announcements`: `ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()` + 既存行を `UPDATE ... SET updated_at = created_at` でバックフィル（しないと「全件が今更新された」誤判定）+ `set_updated_at()` トリガ関数（`CREATE OR REPLACE`、冪等）+ `announcements` に BEFORE UPDATE トリガ
   - `trainings`: `ADD COLUMN recert_at timestamptz NOT NULL DEFAULT now()` + 既存行を `UPDATE ... SET recert_at = created_at` でバックフィル。**トリガは付けない**（admin が「再受講を求める」を選んだときだけ app が `recert_at = now()` をセット）
   - `NOTIFY pgrst, 'reload schema'`

2. **DB ビュー / RPC（migration 189 — 新規）**
   - `employee_progress` view（185 を `DROP VIEW` → `CREATE VIEW`、`security_invoker=true` 維持）
   - `get_my_subordinate_progress(uuid)` RPC（187 を `CREATE OR REPLACE`、RETURNS TABLE 構造不変）
   - 変更する集計サブクエリ:
     - `announcements_read`: `announcement_reads` JOIN → `announcement_view_logs` で `EXISTS viewed_at >= a.updated_at` に
     - `manuals_read`: 同様に `manual_view_logs` で `viewed_at >= m.updated_at`
     - `trainings_passed`: `result='passed'` に加え `EXISTS 合格 submission の submitted_at >= t.recert_at`
     - `compliance_done`: **無変更**（既に `ca.document_updated_at = cd.updated_at`）
   - `last_announcement_at` / `last_manual_at` / `last_training_at` も同じ版条件で `max()` を取り直す

### サーバー層

3. **API**: `app/api/reports/route.ts`
   - `itemsSel`（L82）に `updated_at` を追加（compliance/manual は既存列、announcement は 188 追加列、training は `recert_at` も追加）
   - レスポンス items map（L205-213）に `updated_at` / `recert_at` を含める

### クライアント層

4. **閲覧レポート**: `components/admin/ReportMatrix.tsx`
   - `ItemRow` interface（L37-46）に `updated_at: string` / `recert_at?: string`（研修用）追加
   - セル描画（L575-668）を 3-way 化（後述 §3）
   - サマリーカード「既読セル」（L463）を「現版 / 旧版 / 未読」に分解、`readCells` ループ（L370-380）で振り分け、全体既読率（L380）は「現版既読 / 対象セル総数」に
   - CSV エクスポート（L382-408）のセル値に旧版/現版/未読の区別を反映
   - ツールチップ（L604-607）に旧版セルでは「※この閲覧履歴は旧版です」を前置

5. **研修の編集 UI**: `app/(admin)/admin/trainings/` + `app/(manager)/mgr/trainings/[id]/edit/` の編集フォーム
   - 「この変更で再受講を求める」チェックボックス追加。保存時 ON なら `recert_at: new Date().toISOString()` を update に含める

6. **お知らせ社員ページ**: `app/(employee)/my/announcements/page.tsx`
   - `isRead` 判定を版考慮化（`announcement_view_logs` の `max(viewed_at) >= announcement.updated_at`）
   - `markRead` を「初回 insert のみ」から「開くたび view_log 追加」に（再閲覧で現版閲覧が成立するように）

7. **業務マニュアル社員ページ**: `app/(employee)/my/manuals/page.tsx`
   - 上記 6 と同じ版考慮化

8. **社員ダッシュボード**: `app/(employee)/my/dashboard/page.tsx`
   - `announcement_reads` / `manual_reads` 直クエリ（L202, L204）を版考慮の集計に揃える（揃えないと社員の自己ダッシュボードだけ旧版を既読カウントしてズレる）

### 横断

9. **ドキュメント**: `docs/reference-map.md` に migration 188/189 + `recert_at` / `announcements.updated_at` の参照を追記。`docs/error-log.md` に今回の乖離事象を記録。`docs/progress.html` 更新

---

## 3. 表出箇所マップ

| 箇所 | 内容 |
|---|---|
| サイドバー / ナビ | 該当なし |
| ダッシュボードのカード | ✅ admin/mgr「社員進捗一覧」の進捗バッジ `{done}/{total}` の `done`（お知らせ/マニュアル/研修）が版考慮で**減りうる**。UI ファイルは無変更（189 の view/RPC が値を変える）|
| 閲覧レポート マトリクス | ✅ セルが 3 状態: `✗ 未読`（赤・現状）/ `✓ 現版 N回`（青・現状）/ `⚠ 旧版 N回`（**新規・琥珀 `bg-amber-50 text-amber-700`**、⚠アイコン + 「旧版」テキスト併用 = §9 アクセシビリティ準拠）。サマリーカードは「現版 / 旧版 / 未読」3カウント |
| 設定画面 | 該当なし |
| 通知・トースト・モーダル | ✅ 研修編集モーダルに「再受講を求める」チェックボックス。社員側 my/announcements・my/manuals の未読バッジ + layout 赤バッジ（`notifyBadgeRefresh`）が編集後に増える |
| ヘッダー・フッター・パンくず | 該当なし |
| ロール別の表示差異 | 研修の「再受講を求める」チェックは admin（全研修）/ manager（自施設研修）が編集時に操作可。employee は閲覧のみ。詳細は §5 |
| モバイル時の表示 | ReportMatrix は既存の横スクロール踏襲。3-way セルも既存セル幅内。研修編集チェックボックスは既存フォームに1行追加 |

---

## 4. 連動更新ポイント

| トリガー | 連動して触るファイル / 関数 |
|---|---|
| `announcements` に `updated_at` 追加 | migration 188 / `lib/types.ts` の `Announcement` 型に `updated_at: string` / `app/api/reports/route.ts` の `itemsSel` |
| `trainings` に `recert_at` 追加 | migration 188 / `lib/types.ts` の `Training` 型に `recert_at: string` / `app/api/reports/route.ts` の `itemsSel` |
| `set_updated_at()` トリガ関数新設 | migration 188（`announcements` に attach。compliance/manuals への retrofit は §7 の sub-decision） |
| `employee_progress` view 再定義 | migration 189。`ProgressDashboard.tsx` 等は列構造不変のため**無変更** |
| `get_my_subordinate_progress` RPC 再定義 | migration 189。RETURNS TABLE 不変のため `mgr/dashboard/page.tsx` は**無変更** |
| ReportMatrix 3-way セル | `components/admin/ReportMatrix.tsx`: `ItemRow` 型 / セル描画 / `readCells` 集計 / `exportCsv` / ツールチップ |
| `/api/reports` items に版列追加 | `app/api/reports/route.ts`: `itemsSel`(L82) + items map(L205-213) |
| 研修編集に「再受講を求める」追加 | `app/(admin)/admin/trainings/` 編集フォーム + `app/(manager)/mgr/trainings/[id]/edit/page.tsx` の `update()` |
| お知らせ / マニュアル社員ページ版考慮化 | `app/(employee)/my/announcements/page.tsx`・`app/(employee)/my/manuals/page.tsx` の `isRead` 判定 + `markRead` の logView |
| 社員ダッシュボードの集計 | `app/(employee)/my/dashboard/page.tsx` の `announcement_reads`/`manual_reads`/`training_submissions` 集計 |
| migration 188/189 + 新カラム | `docs/reference-map.md`（§14 命名 / 参照台帳）/ `docs/error-log.md` / `docs/progress.html` |
| 両 repo 同期 | staffbase（worktree `relaxed-morse-e8230e`）と deaf-ic 双方に同一変更。色クラスのみ `diletto-` ⇔ `brand-` 差 |

ファイル一覧:
- `supabase/migrations/188_*.sql`（新規）
- `supabase/migrations/189_*.sql`（新規）
- `lib/types.ts`
- `app/api/reports/route.ts`
- `components/admin/ReportMatrix.tsx`
- `app/(admin)/admin/trainings/page.tsx`（または編集フォームコンポーネント）
- `app/(manager)/mgr/trainings/[id]/edit/page.tsx`
- `app/(employee)/my/announcements/page.tsx`
- `app/(employee)/my/manuals/page.tsx`
- `app/(employee)/my/dashboard/page.tsx`
- `docs/reference-map.md` / `docs/error-log.md` / `docs/progress.html`

---

## 5. ロール別権限マトリクス

| 操作 | admin | manager | employee |
|---|---|---|---|
| 閲覧レポートの 3-way 表示を見る | ✅ 全社員 × 全アイテム | ✅ 管轄施設の社員のみ（既存 `/api/reports` のフィルタ） | ❌ |
| ダッシュボード「社員進捗一覧」の版考慮バッジ | ✅ テナント全社員 | ✅ 管轄施設の部下 | ❌ |
| 研修編集時に「再受講を求める」を選択 | ✅ 全研修 | ✅ 自施設の研修のみ（既存の研修編集権限の範囲） | ❌ |
| 編集後に「未読 / 旧版」に戻った項目を解消（再閲覧・再受講） | — | — | ✅ 自分の分のみ |
| 自分の進捗が版考慮で表示される（my/dashboard・my/announcements 等） | ✅ | ✅ | ✅ |

shift_manager: 閲覧レポート対象外（`/api/reports` が `neq('role','shift_manager')`）/ `get_my_subordinate_progress` も 171 で除外済み。研修編集 UI には到達しうるが既存の権限制御に従う（本機能で新たな差分は作らない）。

---

## 6. 既存機能との差分・依存

- **`dashboard-published-filter.md`（既存スペック）との関係**: あれは「未公開コンテンツを分母から外す」機能。本機能は「公開済みのうち版が古いものを分子から外す」機能。**別機能**として並存。migration 184-187 の延長線上で、187 の §「将来対応」に書かれた分子クリーンアップの続きにあたる。
- **`合格者再提出`（直近実装）との関係**: 研修は合格者も再提出可能（`canResubmit` に `passed` 追加済み）。`recert_at` 更新で「合格だが旧版」になった社員は、この既存の再提出フローでそのまま再受講できる。my/trainings 側は「再受講が必要」の明示表示を追加する余地あり（§8 将来対応）。
- **依存テーブル / 列**:
  - 既存: `compliance_documents.updated_at`・`manuals.updated_at`・`compliance_acknowledgments.document_updated_at`・`{category}_view_logs`（111）
  - 新規: `announcements.updated_at`（188）・`trainings.recert_at`（188）
- **本変更で影響を受ける既存機能**: 社員側の未読バッジ / layout 赤バッジ（編集後に未読が増える）/ ダッシュボード達成率（お知らせ・マニュアル・研修の分子が版考慮で下がりうる）。

### 設計の核（現版判定の単一ルール）

**「現版閲覧/確認済み」(employee × item) = `{category}_view_logs` に `viewed_at >= 版基準日時` の行が存在する**

| カテゴリ | 版基準日時 | 編集での前進 |
|---|---|---|
| 遵守事項 | `compliance_documents.updated_at` | 全編集（app 管理、既存）|
| お知らせ | `announcements.updated_at` | 全編集（188 トリガ）|
| 業務マニュアル | `manuals.updated_at` | 全編集（app 管理、既存）|
| 研修 | `trainings.recert_at` | 「再受講を求める」ON 時のみ |

レポートもダッシュボードもこの同一ルールで判定するため、両者は構造的に一致する。compliance のダッシュボードは `ack.document_updated_at = updated_at` のままだが、ack 時に必ず view_log も生成される（`handleAcknowledge` 内 `logView`）ため view_log ベースの現版判定と一致する（=無変更で整合）。

---

## 7. 実装ルール

- 命名: 新列は `updated_at`（既存 compliance/manuals と統一）、研修の再受講基準は `recert_at`（SCREAMING_SNAKE 不要、snake_case カラム §11）。マイグレーションは `188_add_updated_at_announcements_recert_trainings.sql` / `189_progress_version_aware.sql`
- 既存マイグレーション変更禁止（CLAUDE.md §7）→ 新規 188/189 のみ
- 旧版セルの色は `bg-amber-50 text-amber-700` + ⚠ アイコン + 「旧版」テキスト（色のみで情報を伝えない §9）
- ReportMatrix の既存 `viewMap` / `audienceFor` / CSV ロジックは**再利用**。3-way 化は描画分岐の追加のみで構造は変えない
- 研修編集チェックボックスは既存フォームに1行追加。未チェック時は `recert_at` を update 句に**含めない**（前進させない）
- `last_viewed_at >= updated_at` の同値境界は「現版」側に倒す（`>=`）。編集と同時刻の閲覧を未読化しない
- バックフィル必須: 188 で `updated_at = created_at` / `recert_at = created_at`（既存行を「今編集された」にしない）

### sub-decision（確定）

`set_updated_at()` トリガは **`announcements` のみ**に付ける（承認時決定）。`compliance_documents` / `manuals` は従来どおり app 管理（admin ページが明示セット）。4兄弟テーブルで方式が2系統になる点は migration 188 のコメントで明示する。

---

## 8. 完成条件

### 正常系（localhost で確認 — staffbase:4003 / deaf-ic:6001）
- [ ] 遵守事項を編集 → 該当社員の閲覧レポートセルが「⚠旧版」になり、ダッシュボード「社員進捗一覧」の数値と一致する
- [ ] お知らせ / マニュアルを編集 → 既読だった社員のセルが「⚠旧版」に、社員の my/announcements・my/manuals でも「未読」に戻る
- [ ] 研修を編集 + 「再受講を求める」ON → 合格者がダッシュボード `trainings_passed` から外れる / OFF → 何も変わらない
- [ ] 旧版になった項目を社員が再閲覧 / 再受講 → 「✓現版」に戻り、ダッシュボードにも復帰
- [ ] 閲覧レポート サマリーが「現版 / 旧版 / 未読」3カウントで表示され、現版既読率がダッシュボード達成率（compliance）と一致

### 異常系・境界値
- [ ] 未編集アイテムは全社員「現版」（バックフィル `updated_at=created_at` で `viewed_at >= updated_at` が成立）
- [ ] `viewed_at = updated_at` 同値 → 「現版」側
- [ ] view_log が1件も無い社員 → 「✗未読」（現状維持）
- [ ] 研修「再受講を求める」を複数回 ON → `recert_at` が都度前進、最新の編集が基準
- [ ] CSV を Excel で開いて現版/旧版/未読が日本語で読める

### 確認
- [ ] `npm run build` 両 repo パス
- [ ] migration 188/189 を両 Supabase に適用、ダッシュボード/レポートで目視一致
- [ ] ダッシュボード UI ファイル（ProgressDashboard 等）に差分が無い（view/RPC 列構造不変の裏取り）

### 将来対応（今回スコープ外）
- ~~my/trainings に「再受講が必要」の明示バッジ表示~~ → **§9 追補（2026-05-21）で対応**
- リマインドメールを版考慮の未読者へ送る判定

---

## 9. 追補（2026-05-21）: /my/trainings の recert 反映

> ステータス: 承認済（2026-05-21）。両 repo に適用。

### 9-1. 背景・目的
本体実装（migration 188/189）で研修の `recert_at` を進めると、ダッシュボード・閲覧レポート・
layout 赤バッジ・my/dashboard は版考慮済みになった。しかし社員専用の研修ページ
`/my/trainings` だけが未対応のまま（§8 将来対応に記載）。その結果、admin/manager が
「再受講を求める」ON で研修を編集しても `/my/trainings` のカテゴリカードが「完了」
「N/N 合格」「100%」のままで、社員にどの研修の再受講が必要か伝わらない（ユーザー報告）。
本追補で `/my/trainings` を版考慮にする。

### 9-1b. 他3カテゴリの確認結果（2026-05-21 調査）

ユーザー指摘を受け、4カテゴリすべての社員カテゴリページを実コードで確認した:

| 社員ページ | 版考慮 | 根拠 |
|---|---|---|
| `/my/compliance` | ✅ 対応済 | `ackMap` が `ack.document_updated_at === doc.updated_at` で判定（migration 017 由来。元から版考慮）。catStats / 進捗バーは ackMap 由来 |
| `/my/announcements` | ✅ 対応済 | content-version-tracking 本体で `isRead = view_log.lastAt >= announcements.updated_at` に変更済（`select('*')` で updated_at 取得）。catStats / 進捗バーは isRead 由来 |
| `/my/manuals` | ✅ 対応済 | 同上（`isRead = view_log.lastAt >= manuals.updated_at`）|
| `/my/trainings` | ❌ 未対応 | 完了判定が `result==='passed'` のみで recert 未考慮 ← **本 §9 の対象** |

研修だけが取り残された理由: 研修の完了は `training_submissions.result` の判定（合否）フロー由来で、
他3カテゴリのような version-snapshot 列（compliance の `document_updated_at`）や view_log ベースの
`isRead`（announcements / manuals）を使っていないため。よって本 §9 のスコープは
`/my/trainings` のみで正しい。

### 9-2. 設計（現版合格の判定）
クライアント側 predicate（DB・API 変更なし）:
- **現版合格** = `submission.result === 'passed'` かつ `submission.submitted_at >= training.recert_at`
- **要再受講（旧版合格）** = `submission.result === 'passed'` かつ `submission.submitted_at < training.recert_at`

`trainings` は `select('*')` で取得しており `recert_at`（migration 188）は取得済み、
`submission.submitted_at` も既存列。**追加クエリ不要**。`subMap` は training_id ごとに
最新提出 1 件を保持する設計のため、最新提出で判定すれば足りる（再提出 pending 中は
`result≠passed` で「未完了」、再受講・再合格で `submitted_at` が `recert_at` を超え
「現版合格」に戻る）。

### 9-3. 影響範囲（対象: `app/(employee)/my/trainings/page.tsx` のみ・両 repo）
| 箇所 | 現状 | 変更 |
|---|---|---|
| `passedCount`（L377）| `result==='passed'` を数える | 現版合格のみ数える |
| `catStats.unfinished`（L384）| `!submission \|\| result==='resubmit'` | 旧版合格も未完了に算入 |
| `uncategorizedUnfinished`（L389）| 同上 | 同上 |
| `catDone`（L428）| `result==='passed'` を数える | 現版合格のみ数える |
| `TrainingsGrid` の `ItemGridCard` | `acknowledged = result==='passed'` | `acknowledged = 現版合格` / 旧版合格は `pendingLabel`「再受講が必要」 |
| 研修詳細モーダル | recert 概念なし | 旧版合格時に「この研修は更新されました。再受講をお願いします」の注意書きを表示 |

DB・API・migration 変更なし。`components/employee/ItemGridCard.tsx` は無変更（既存の `acknowledged`/`pendingLabel` props を使うだけ）。

### 9-4. 表出箇所マップ
| 箇所 | 内容 |
|---|---|
| サイドバー / ナビ | 該当なし（研修バッジは layout 側で本体実装済み・無変更）|
| 全体の合格状況バー（L413）| ✅ 現版合格ベース。recert で 4/4→3/4 等に下がり 100% が外れる |
| カテゴリカード（完了バッジ・進捗バー）| ✅ 現版合格ベース。recert で「完了」バッジが外れる |
| カテゴリカード（赤・未完了バッジ）| ✅ 旧版合格を含めた未完了数を表示 |
| カテゴリ詳細の研修カード | ✅ 旧版合格は「合格」でなく「再受講が必要」表示 |
| 通知・トースト・モーダル | ✅ 研修詳細モーダルに旧版合格時の再受講注意書き |
| ヘッダー・フッター・パンくず | 該当なし |
| ロール別の表示差異 | `/my/trainings` は employee 専用ページ。admin/manager は該当なし |
| モバイル時の表示 | 既存レイアウト維持。表示値・バッジ文言のみ変更 |

### 9-5. 連動更新ポイント
| トリガー | 連動して触る箇所 |
|---|---|
| 現版合格 predicate 追加 | `app/(employee)/my/trainings/page.tsx`（module-level ヘルパー関数として定義）|
| `passedCount` / `catDone` / `unfinished` 集計 | 同ファイルの該当算出箇所（L377 / L384 / L389 / L428）|
| `ItemGridCard` の `acknowledged` / ラベル | 同ファイル module-level `TrainingsGrid` |
| モーダル注意書き | 同ファイル module-level `TrainingsGrid` のモーダル部 |
| ドキュメント | `docs/reference-map.md` §16 に /my/trainings 行を追記 |

他ファイル連動なし（layout・my/dashboard・admin/mgr ダッシュボード・閲覧レポートは本体実装で版考慮済み）。

### 9-6. 完成条件
- [ ] 研修を「再受講を求める」ON で編集 → `/my/trainings` の全体合格状況と該当カテゴリカードが「完了」から外れ、赤の未完了バッジが出る
- [ ] カテゴリ詳細でその研修カードが「合格」でなく「再受講が必要」表示になる
- [ ] 研修詳細モーダルに再受講を促す注意書きが出る
- [ ] 再受講・再合格（`recert_at` 以降の合格提出）で「現版合格」に戻り、完了表示が復活する
- [ ] 「再受講を求める」OFF 編集では `/my/trainings` の表示が一切変わらない
- [ ] 未受講・判定待ち・不合格・要再提出の既存表示が壊れない
- [ ] `npm run build` 両 repo パス / 両 repo 色クラス以外の差分なし

---

## 別視点確認

① ダッシュボード（189 後）の compliance 値とレポートの compliance「現版既読」カウントが完全一致する ② 編集していないアイテムは誰も「旧版」にならない ③ migration 188 のバックフィルで「全件が今編集された」誤判定が起きない ④ 研修「再受講を求める」OFF の編集で既存合格者が一切影響を受けない ⑤ `get_my_subordinate_progress` の RETURNS TABLE 構造が 187 と同一で mgr 画面が無変更で動く ⑥ 社員側 my/announcements・my/manuals・my/dashboard・layout バッジが版考慮で一貫する（admin から見た旧版と社員から見た未読が一致）⑦ shift_manager に新たな権限差分を作っていない ⑧ 両 repo（staffbase / deaf-ic）で色クラス以外の差分が無い
