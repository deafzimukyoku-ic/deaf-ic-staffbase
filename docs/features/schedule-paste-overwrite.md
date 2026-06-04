# 機能仕様: 利用表ペースト＝完全上書き化 ＋ PDF取込廃止

- 機能名: `schedule-paste-overwrite`
- 作成: 2026-06-04
- ステータス: 承認済み（会話で設計決定・即時着手指示あり）

## 1. 機能概要

### 目的
利用表（`schedule_entries`）のコピペ取り込みを、現状の「差分マージ（upsert のみ・削除なし）」から
**「完全上書き（貼り付けに無い当月既存利用は削除）」** に変更する。
あわせて PDF取込を UI から廃止し、取り込み手段をコピペ（旧 Excel貼付）に一本化、ボタン名を「ペースト」にする。

### 背景
- 現状 `handleBulkImport` は `upsert(onConflict: tenant_id,facility_id,child_id,date)` のみで**削除しない**。
  そのため前回ペースト分が残り、当月に古い利用が混ざる（ユーザー実害: 2026-06-04 パズル5月で発生）。
- モーダルは「🔴削除 N」と差分表示していたが、**実際の削除は未実装**（表示と挙動の乖離）。

### スコープ
- やる: コピペ取り込みを完全上書きに変更 / PDF取込ボタン・モーダルを UI から除去 / ボタン名「ペースト」 /
  モーダルの差分UI簡素化（削除件数の警告のみ残す）
- やらない: PDF解析バックエンド（`PdfImportModal.tsx` / `lib/pdf` / 解析API）の物理削除（別タスクへ）/
  送迎の自動再生成 / 利用表以外の取り込み

## 2. 影響範囲（実ファイル）

| 区分 | ファイル / シンボル | 変更内容 |
|---|---|---|
| 取り込みロジック | `components/shift/ScheduleFull.tsx` `handleBulkImport` | upsert 後、当月の `rawEntries` のうち貼付に無い行を chunk DELETE |
| UI（ボタン） | `components/shift/ScheduleFull.tsx` ヘッダーアクション | 📋ボタンを「📋 ペースト」(accent) に / 📄PDF ボタン削除 |
| 状態・取得 | `components/shift/ScheduleFull.tsx` | `pdfModalOpen` / `pickupAreas` / `dropoffAreas` 削除、`facility_shift_settings` 取得ブロック削除、`PdfImportModal` import 削除、未使用型 `Facility`/`AreaLabel` 削除 |
| モーダル | `components/shift/ExcelPasteModal.tsx` | 差分4分類（added/modified/unchanged/protected）と `confirmedTransportEntryIds`（死配線）を除去。代わりに「上書きで既存 N 件削除」警告のみ表示。タイトルを「利用表をペースト」に |
| DB | （マイグレーション不要） | 上書きはアプリロジック。`schedule_entries` の `unique(tenant_id,facility_id,child_id,date)` と `transport_assignments.schedule_entry_id ON DELETE CASCADE` を利用 |

### 核心メカニズム（送迎を壊さない理由）
- `transport_assignments.schedule_entry_id` は **`ON DELETE CASCADE`**（migration 100/112）。
- **再登録される利用**（同 child_id+date が貼付に存在）→ `upsert ... DO UPDATE` で**行を in-place 更新**し
  `id` を保持 → 送迎割当の FK は無傷 → **送迎表は変わらない**（ユーザー要件）。
- **貼付に無い利用**（消える側）→ DELETE → CASCADE で送迎も道連れ（ユーザー指示「全部消す＝完全上書き」）。

## 3. 表出箇所マップ

- サイドバー / ナビ: 該当なし（ルートは不変）
- ダッシュボードのカード: 該当なし
- 設定画面: 該当なし
- 通知 / トースト / モーダル: 利用表ヘッダーの「ペースト」ボタン → `ExcelPasteModal`。確定時 `alert` で「N件で上書き（古いM件削除）」表示
- ヘッダー / フッター / パンくず: 該当なし
- ロール別表示差: admin / manager / shift_manager の利用表（`ScheduleFull`）に表示。employee は利用表UI自体に到達しない（閲覧は published シフトのみ）
- モバイル時: ボタンは既存のヘッダー flex に並ぶ（追加レイアウト変更なし）

## 4. 連動更新ポイント

- `[ScheduleFull.handleBulkImport 変更]` → 取り込みは `ExcelPasteModal.onConfirm` と `PdfImportModal.onConfirm` の
  両方から呼ばれていた。PDF側UIを除去するため、呼び出しは `ExcelPasteModal` のみに収束。
- `[PdfImportModal UI 除去]` → `import PdfImportModal` / `pdfModalOpen` / `<PdfImportModal>` / 📄ボタン /
  `pickupAreas`・`dropoffAreas`・`facility_shift_settings` 取得（PDFマーク推論専用）を ScheduleFull から除去。
- `[ExcelPasteModal 差分UI 簡素化]` → `confirmedTransportEntryIds`（親が未供給の死配線）/ `DiffClass` /
  per-cell 差分着色を除去。`existingEntries`・`childNameToId` は「削除件数の警告」算出にのみ流用。
- `[schedule_entries への DELETE 追加]` → RLS は既存の `se_admin_all`(FOR ALL) / `se_manager_facility`(FOR ALL,
  manager+shift_manager, migration 140) が DELETE を許可済み。新規ポリシー不要。
- `docs/reference-map.md` の「schedule_entries 取り込み」記述を「upsert＋当月差集合DELETE（送迎cascade）」に更新。
- `docs/error-log.md` に「差分表示はあるが削除未実装→上書き化」の学習を記録。

## 5. ロール別権限マトリクス

| ロール | 利用表ペースト（上書き取込） | 当月既存利用の削除 | 送迎の cascade 削除 |
|---|---|---|---|
| admin | ✅（全施設） | ✅ `se_admin_all` FOR ALL | ✅ `ta_admin_all` + cascade |
| manager | ✅（管轄施設） | ✅ `se_manager_facility` FOR ALL | ✅ cascade（自施設） |
| shift_manager | ✅（自1施設） | ✅ `se_manager_facility` FOR ALL（migration 140） | ✅ cascade（自施設） |
| employee | ❌ UIなし / SELECT のみ | ❌ | ❌ |

権限は既存 RLS のみで成立。コード変更による権限面の新規付与なし。

## 6. 既存機能との差分・依存

- 似た機能: PDF取込（同じ `handleBulkImport` を共有）→ UI のみ廃止しロジックは共通のまま一本化。
- 依存: `schedule_entries` UNIQUE 制約 / `transport_assignments` FK cascade / `fetchAll` の `rawEntries`（当月分・1施設で<1000行）。
- 影響を受ける既存機能: 送迎表（`TransportFull`）— 削除された利用の送迎行が消える。再登録分は維持。
  利用料金表（`BillingFull`）・日次出力（`DailyOutputFull`）・シフト生成 — 当月利用の集合が「貼付の通り」に確定する。

## 7. 実装ルール

- 命名: 既存に合わせる（camelCase 関数、日本語ユーザー向けメッセージ）。
- 再利用: `ExcelPasteModal` をそのまま利用（差分計算のみ削減）。`getDaysInMonth`/`date-fns` 既存 import。
- DELETE は `.in('id', chunk)` を 100 件刻みで（URL長・上限回避）。エラー時は日本語 alert ＋ `fetchAll()` で UI 同期。
- `console.log` を残さない / `any` 不使用 / エラーハンドリング省略しない。

## 8. 完成条件（チェックリスト）

- 正常系: 既存利用がある月にペースト → 貼付の通りに置き換わる（古い差分が消える）。再登録セルの送迎が維持される。
- 異常系: 児童名全不一致 → 「児童名が一致しませんでした」で**削除せず**中断（誤爆防止）。DELETE 失敗 → 日本語 alert ＋ UI 再取得。
- 境界値: 空の月へのペースト → 削除0・全件挿入。1児童モード貼付でも当月の他児童が消えうる点を警告表示で明示。
- ローカル確認: `npm run build` 通過。PC幅でボタン「ペースト」単独表示、PDFボタン消失。
- 将来対応（分離）: ~~PDF解析バックエンドの物理削除は別タスク~~ → **2026-06-04 撤去完了**（下記 実装メモ）。送迎の自動再生成はやらない（人手で再生成）。

## 実装メモ（実装後追記）
- 2026-06-04 完全上書き＋ペースト改名を実装（commit dbb4050）。
- 2026-06-04 PDF解析バックエンドを撤去:
  - 削除: `components/shift/PdfImportModal.tsx` / `app/api/shifts/import-pdf/route.ts` / `lib/anthropic/parsePdf.ts`（`lib/anthropic/` は空になり消滅）。
  - 温存: `lib/pdf/{generate-pdf,resolve-pdf-values,pdf-utils,bulk-pdf-zip}.ts`（書類PDF生成系で `lib/issued-documents`・`app/api/documents/*` が共有）。
  - `PDF_PARSE_MODEL` は実コードに定数なし（CLAUDE.md 記述のみ）→ constants.ts 変更なし。CLAUDE.md §8/§10 の PDF 解析記述は stale（編集はユーザー判断）。
  - ハマり: ルート削除後 `.next/types` / `.next/dev/types` の stale validator が `tsc`/`build` を落とす。dev 停止中は `.next/dev` 削除→再ビルドで解消（error-log 記録済）。
