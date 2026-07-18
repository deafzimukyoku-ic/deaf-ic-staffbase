# shift-halfday-availability-reflection

> **対象リポ**: deaf-ic + diletto-new-staffbase（コードほぼ同一、CSS prefix のみ差）
> **ステータス**: 承認済（2026-06-17）→ deaf-ic 実装フェーズ
> **起票**: 2026-06-17
> **発端**: 落合良子さん（deaf-ic・🏢本部・2026-07）で AM休/PM休・一日出勤可 がシフト表に反映されない報告

## 1. 機能概要

- **機能名**: shift-halfday-availability-reflection
- **目的**: シフト自動生成で、休み希望の **AM休(am_off)/PM休(pm_off)/一日出勤可(full_day_available)** を、シフト表に正しく反映させる
> **改訂 v2 (2026-06-17)**: ユーザー確定により B の方針変更 + 人員カバレッジに実運用VBAルール採用 + D をスコープ内に。
> - B: 「常勤の生成を制限」→ **「常勤に一日出勤可を出させない（提出UI制限・原典のパート専用に戻す）」**
> - 人員カバレッジ: `docs/shift-coverage-rule.md`（実運用Excel/VBA由来の時間区間判定）を正本として `qualifiedCoverage.ts` を置換
> - D（再生成うながし）をスコープ内に追加

- **スコープ（やる）**:
  - **A. 半休反映**: `shift_assignments` に `am_off`/`pm_off` を追加し、休み希望と同じ AM休/PM休 区分でシフト表に表示。生成・手動編集・社員公開ビューすべてで表現可能にする。半休者は**勤務時間区間**を持つ（PM休=午前のみ / AM休=午後のみ）
  - **B. 一日出勤可 = opt-in 申告（v3 改訂 2026-06-17）**: 一日出勤可(`full_day_available`)を**1つでも出した人**は「申告した日だけ出勤・希望未記入の空白日は休み(off)」になる。**常勤・パート問わず**適用。提出UIの制限は無し（常勤も一日出勤可を出せる）。一日出勤可を1つも出していない常勤は従来どおりデフォルト出勤。<br>※ v2 の「常勤に出させない」案は撤回（MyRequestsView の制限コードは revert 済）
  - **人員カバレッジのVBAルール移植**: `lib/logic/qualifiedCoverage.ts` を `docs/shift-coverage-rule.md` の時間区間ベース判定（有資格者カウント / 最小2名 / 3名×時間ルール）に置換。半休者が勤務区間分だけ正しくカウントされるようにする
  - **D. 再生成うながし**: 希望提出時刻 > シフト生成時刻 の月に「要再生成」警告を出す
- **スコープ（やらない／別フェーズ）**:
  - C（兼任二重生成）: §6 で関連説明。**別 issue 化**（落合さん=本部+パステルの両施設 normal 二重生成は本機能の対象外）
  - 半休の「時間帯を分単位で自由設定」: 半休は固定境界（後述の昼区切り X）で表現、自由時間入力は対象外
  - 既存の常勤の full_day_available データ（落合さん16件等）の遡及クリーンアップ: 害が無い（normal相当）ため放置。必要なら別途

## 2. 影響範囲

| 種別 | 具体箇所 |
|---|---|
| **DBスキーマ** | `shift_assignments.assignment_type` の CHECK制約 `shift_assignments_assignment_type_check`。現行 `normal/public_holiday/requested_off/paid_leave/off` に **`am_off`,`pm_off` を追加する migration**（deaf-ic + diletto 両方）。enum でなく text + CHECK なので ALTER CONSTRAINT で対応 |
| **型** | `lib/types.ts:856` `ShiftAssignmentType` union に `'am_off' \| 'pm_off'` 追加 |
| **生成ロジック** | `lib/logic/generateShift.ts`（A: am_off/pm_off を専用 type に / B: full_time の full_day_available 制限） |
| **グリッド表示** | `components/shift/ShiftGridFull.tsx:67-73` `TYPE_CONFIG`（AM休/PM休 の色・ラベル追加）+ `:120-135` 出勤カウント |
| **手動セル編集** | `components/shift/ShiftFull.tsx:863-880` 編集タイプ選択ボタン（5値→7値） |
| **社員公開ビュー** | `components/employee/MyFacilityShiftView.tsx` `TYPE_CONFIG`（AM休/PM休 表示） |
| **人員カバレッジ** | `lib/logic/qualifiedCoverage.ts:77-81` `assignment_type !== 'normal'` 除外判定（半休を在席として数えるか） |
| **API層** | `lib/api/shiftAssignments.ts`（型経由のみ。ロジック変更は無し想定／要確認） |
| **日次出力/日報** | `components/shift/DailyOutputFull.tsx` / `DailyReportFull.tsx`（出勤者一覧で半休をどう出すか／要確認） |
| **社員ダッシュ** | `app/(employee)/my/dashboard/page.tsx`（本日のシフト表示で半休ラベル／要確認） |

constraints.md 確認済: 新規 cron / 重処理 / 外部API 追加なし → **プラン制約への抵触なし**。

## 3. 表出箇所マップ（空欄禁止）

| 出現場所 | 内容 |
|---|---|
| サイドバー/ナビ | 該当なし |
| ダッシュボードのカード | `app/(employee)/my/dashboard` の「本日のシフト」表示に AM休/PM休 ラベルが出る可能性 → §連動で要確認対応 |
| 設定画面 | 該当なし |
| 通知/トースト/モーダル | 手動セル編集モーダル（ShiftFull）に AM休/PM休 ボタンが増える |
| ヘッダー/フッター/パンくず | 該当なし |
| ロール別表示差 | admin/manager: シフト表で AM休/PM休 セルを閲覧・手動設定可。employee: 自分の公開シフト(MyFacilityShiftView)で AM休/PM休 を閲覧のみ |
| モバイル時 | ShiftGridFull は既存の横スクロール表。セル内ラベルが「AM休/PM休」になるのみで構造変化なし |

## 4. 連動更新ポイント（空欄禁止・「など」禁止）

| トリガー | 連動して触るファイル/関数 |
|---|---|
| `ShiftAssignmentType` に am_off/pm_off 追加 | `lib/types.ts:856`。これを参照する全 `Record<ShiftAssignmentType, …>` が型エラーになるので網羅対応（下記すべて） |
| CHECK制約変更 | 新 migration `NNN_shift_assignment_halfday.sql`（deaf-ic）/ 対応番号（diletto）。末尾に `NOTIFY pgrst, 'reload schema';`。`docs/migration-applied.md` 追記 |
| 生成: 半休マッピング | `lib/logic/generateShift.ts:71-92`（requestMap に amOff/pmOff Set を分離）+ `:116-153`（assignmentType 決定で am_off/pm_off を割当、start/end を半日時間に設定） |
| B: 一日出勤可をパート専用化 | `components/shift/MyRequestsView.tsx`（`SELECTABLE` 配列から full_time のとき `full_day_available` を除外）。生成側 `generateShift.ts` の full_time 分岐は**変更しない**（デフォルト normal 維持） |
| 人員カバレッジ移植 | `lib/logic/qualifiedCoverage.ts` 全面置換（`docs/shift-coverage-rule.md` の CountQualified/CheckMinCoverage/NeedAdditional を移植）。入力は各職員の当日 (start,end) 区間。呼出元 `ShiftGridFull`/`generateShift` の warning 接続も更新 |
| D: 再生成うながし | `components/shift/ShiftFull.tsx`（月内 shift_requests の最大 submitted_at > shift_assignments の最大 created_at なら「要再生成」バッジ表示）+ `MonthStatusBadge.tsx` 連携検討 |
| グリッド色/ラベル | `components/shift/ShiftGridFull.tsx:67-73` `TYPE_CONFIG` に am_off/pm_off 追加 |
| グリッド出勤集計 | `components/shift/ShiftGridFull.tsx:120-135` `pickPrimary`/`rec.work` 系（半休を 0.5 か 1 か 0 でカウント — §決定事項） |
| 手動編集ボタン | `components/shift/ShiftFull.tsx:863-880` の type 配列とラベル/色 Record |
| 手動編集の適用 | `components/shift/ShiftFull.tsx:426`/`:986` 付近の editType 分岐（note 入力可否など、am_off/pm_off を normal 同様に時間付きで保存するか off 同様か） |
| 社員公開ビュー | `components/employee/MyFacilityShiftView.tsx` `TYPE_CONFIG` に am_off/pm_off |
| 人員カバレッジ | `lib/logic/qualifiedCoverage.ts:77-81`（半休を在席カウントに含めるか — §決定事項） |
| 日次出力/日報 | `components/shift/DailyOutputFull.tsx` / `DailyReportFull.tsx` の assignment_type 分岐（半休の出し方）— 要確認して対応 |
| reference-map | `docs/reference-map.md` の ShiftAssignmentType / generateShift / ShiftGridFull エントリ更新 |
| error-log | 落合さん事例（半休消失・常勤一日出勤可無効・stale）を真因として記録 |
| 両リポ同期 | deaf-ic 実装後、diletto に同一パッチ（CSS prefix `brand-`→`diletto-` 差のみ）+ 対応 migration |

## 5. ロール別権限マトリクス

| ロール | シフト表で AM休/PM休 閲覧 | 手動でセルを AM休/PM休 に設定 | 自動生成での反映 |
|---|---|---|---|
| `admin` | 可 | 可 | 可 |
| `manager` | 可（自施設） | 可（自施設） | 可 |
| `employee` | 可（自分の公開シフト MyFacilityShiftView のみ、閲覧専用） | 不可 | 自分の希望が生成に反映される |

## 6. 既存機能との差分・依存

### 既存の半休まわり
- 休み希望(shift_requests)には既に `am_off`/`pm_off`/`full_day_available` が存在（CHECK制約で確認済）
- 本機能は **shift_assignments 側にも同じ区分を持たせて対称化**する。新概念の導入ではなく「希望にあるのに割当に無かった」非対称の解消

### 半休の時間境界（生成時の start/end）
- 既存の facility_shift_settings に core_start_time / core_end_time あり。半休の境界は **正午(12:00)固定** か **core_start/end の中点** のどちらか → §決定事項（推奨: 正午固定でシンプルに）
- AM休 = 午前休 → 午後勤務（start=12:00, end=通常終業）
- PM休 = 午後休 → 午前勤務（start=通常始業, end=12:00）

### 関連所見（今回スコープ外を推奨、別 issue 化）
- **C. 兼任二重生成**: 落合さん(本部+パステル)が両施設で normal を二重生成され、希望が提出先施設にしか効かない（7/29希望休がパステルで normal）。本機能(A/B)では直らない別構造問題。**別 issue 推奨**
- **D. 鮮度/再生成**: 生成後に希望提出/変更すると再生成まで反映されない。本機能デプロイ後も **管理者が対象月を再生成する必要**がある（落合さん7月も要再生成）。「希望提出後に未再生成の月へ警告バッジ」等は **別 issue 推奨**

### この変更で影響を受ける既存機能
- `qualifiedCoverage`（有資格者カバレッジ）: 半休を normal 扱いから外すと現状ロジックでは在席ゼロ計上になる → 半休の扱いを明示決定（§決定事項）
- 既存の published シフトデータ（過去月）: am_off/pm_off は新規値なので過去データには出現せず、後方互換に問題なし

## 7. 実装ルール

- 命名: 新 type は休み希望と完全一致の `am_off` / `pm_off`（独自名を作らない）
- ラベル: 「AM休」「PM休」（AdminRequestsView/MyRequestsView の既存表記 `TYPE_LABEL` と統一）
- 色: 休み希望側の既存色（am_off=blue系, pm_off=indigo系）を ShiftGridFull/MyFacilityShiftView でも踏襲
- design-system: 既存 CSS 変数（deaf-ic=`var(--*)` / diletto=同等）を流用、新規トークン追加なし
- 生成の全off事故防止: full_time の B ロジックは「availableDays が**空でない**場合のみ提出日限定。空ならデフォルト normal」を厳守
- モバイル: 既存グリッド構造維持、ラベル文字数のみ

## 8. 完成条件

### 正常系（落合さん7月・deaf-ic で実証）
- [ ] 7/13 PM休 提出 → 再生成 → 本部グリッドで「PM休」表示（start=通常始業, end=12:00 相当）
- [ ] full_day_available 16日提出（常勤）→ 再生成 → その16日のみ normal、他平日 off、日曜 off
- [ ] 7/29 希望休 → requested_off 表示（本部）
- [ ] 社員公開ビュー(MyFacilityShiftView)でも AM休/PM休 が見える
- [ ] 手動でセルを AM休/PM休 に設定 → 保存 → 再読込で保持

### 異常系/境界値
- [ ] full_day_available を1件も出していない常勤 → 全 off にならずデフォルト normal を維持
- [ ] 同一日に am_off と pm_off が両方提出された矛盾データ → 優先順位を定義（後勝ち or requested_off 扱い）§決定事項
- [ ] am_off/pm_off を含む月の人員カバレッジ警告が壊れない
- [ ] 既存5値のみの過去月シフトが従来通り表示される（後方互換）
- [ ] CHECK制約違反 INSERT が migration 後に通る（am_off/pm_off）

### ローカル確認
- [ ] `npx tsc --noEmit` 両リポでクリーン（ShiftAssignmentType 拡張の型波及を全解消）
- [ ] deaf-ic localhost で 本部7月 を再生成 → 落合さんの3区分が正しく出る
- [ ] diletto localhost で回帰（半休を使う施設があれば）

### 将来対応の分離
- C（兼任二重生成）/ D（再生成うながし）は別 issue
- 半休の分単位自由時間設定は対象外

---

## 決定事項

| # | 項目 | 状態 |
|---|---|---|
| 1 | **半休の勤務区間** | ✅ 確定: **PM休=`[出勤, 13:30]`（午前勤務）/ AM休=`[14:30, 退勤]`（午後勤務）**。出勤=default_start\|\|09:30、退勤=default_end\|\|18:00。13:30〜14:30 は空き帯（引き継ぎ）。生成の start/end とカバレッジ区間の両方にこの値を使う |
| 2 | 半休の人員カウント | ✅ 確定: `docs/shift-coverage-rule.md`（VBA 時間区間ルール）採用。半休者は勤務区間分だけカウント。`qualifiedCoverage.ts` を置換 |
| 3 | 手動編集UIに AM休/PM休 追加 | ✅ 追加（現状シフト割当編集は5値のみで半休不在。ユーザーの「既にある」は休み希望提出UI=MyRequestsView の方）。admin が手で半休セルを置けるようにする |
| 4 | 同日 am_off+pm_off 矛盾時 | ✅ 確定: `requested_off`（終日休）に丸め |
| 5 | B の実現方法 | ✅ 確定: 常勤に提出させない（MyRequestsView でパート専用化）。生成ロジックは不変 |
| 6 | C（兼任二重生成）/ D（再生成） | ✅ 確定: C=別issue / D=今回スコープ内 |

→ **残る確認は #1（昼区切り X）のみ**。確定すれば実装着手可能。

## 実装メモ（実装後に追記）

- **下流ビューの追従（2026-07-18・別仕様書に分離）**: 本仕様書はシフト表・人員カバレッジへの半休反映で完結していたが、
  §2 で「要確認」としていた **日次出力（ホワイトボード）と送迎表は追従できておらず**、半休職員が出勤者・送迎候補として
  表示されない不整合が残っていた（`assignment_type === 'normal'` 直書きで抽出）。これを
  [[shift-halfday-transport-whiteboard]]（`docs/features/shift-halfday-transport-whiteboard.md`）で解消。
  出勤判定を `lib/logic/shiftAssignment.ts`（`isWorkingAssignmentType` / `isWorkingShift`）に一元化した。
