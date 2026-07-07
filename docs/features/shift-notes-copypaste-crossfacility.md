# shift-notes-copypaste-crossfacility — シフト表3機能（行事メモ2行 / セルコピペ / 兼任相互反映）

- 作成: 2026-07-03
- 状態: **承認済み（チャットで事前承認）** — 2026-07-03 ユーザー指示「①やる / ②③はBで対応 / ④は調査してから実装」。
  本仕様書は実装と同時に確定版として起票し、実装後に「実装メモ」を追記する。
- 背景: 納品先（名古屋ろう国際センター）からの改善要望メール（2026-07-03 受領）①②③④。

---

## 1. 機能概要

| # | 機能名 | 目的 |
|---|---|---|
| A | shift-day-notes | シフト表の日付ヘッダと職員行の間に**日別の自由記入メモ 2 行**（学校行事・施設行事・会議等）を設け、シフト作成時に行事を見ながら組めるようにする |
| B | shift-cell-copy-paste | セル編集モーダルから「この日をコピー」→ 他セルを連続クリックで**1日分の勤務内容（区分・時刻・分割・メモ）を複製**。パート職員の同一勤務時間入力を省力化 |
| C | cross-facility-mutual-reflection | 兼任職員の他施設勤務を**全施設同時作成（draft 混在）でも相互に見える**ようにする。(1) 生成が兼任職員を非主所属施設でフル出勤で埋める問題を解消、(2) セルが存在すると「○○勤務」バッジが消える表示条件を修正、(3) 出勤系セルと他施設勤務の**重複を ⚠ で可視化** |

### スコープ外（今回やらない・将来候補）
- メモ行・他施設勤務バッジの **employee 側**（/my 施設シフト表・自シフト）への表示
- 兼任職員の行を「勤務がある月だけ表示」に絞るオプション（先方要望④後半。別途承認後）
- 勤務時間パターンのプリセット登録（②のA案。B案で様子見）
- 送迎表・日次出力・業務日報へのメモ行転載

---

## 2. 影響範囲（実コードで確認済み）

### DB
- **新テーブル `shift_day_notes`**（migration 219）: `tenant_id / facility_id / date / row_no(1|2) / content` + UNIQUE(tenant_id,facility_id,date,row_no) + RLS（§5）
- 既存テーブル変更なし。`shift_assignments` は読み書きパターンのみ変化（コピペは既存 `replaceShiftDay` を再利用）

### 変更ファイル
| ファイル | 変更 |
|---|---|
| `supabase/migrations/219_shift_day_notes.sql` | 新規（テーブル + RLS + set_updated_at トリガ再利用） |
| `scripts/apply-migration-219.mjs` | 新規（pooler 経由 / constraints.md §2 準拠。旧 218 は直接ホストで書かれていたが踏襲しない） |
| `lib/types.ts` | `ShiftDayNoteRow` 追加 |
| `lib/logic/generateShift.ts` | 兼任職員（`staff.facility_id ≠ 生成対象 facility`）の空白日を `off` に（part_time と同扱い） |
| `components/shift/ShiftFull.tsx` | メモ fetch/保存、コピー&ペーストの状態・バナー・貼り付け、他施設勤務 fetch の拡張（am_off/pm_off + 時刻）、重複警告トーストの共通化 |
| `components/shift/ShiftGridFull.tsx` | メモ2行の描画・編集、他施設勤務の表示条件変更 + ⚠重複マーカー |
| `docs/reference-map.md` / `docs/progress.html` / `docs/migration-applied.md` | 追記 |

### 連動しないことの確認
- `ShiftGridFull` の他の利用箇所: なし（`ShiftFull.tsx` のみ。`NotificationsBell.tsx` はコメント内の z-index 言及のみ）
- employee 側 `/my/requests?tab=facility-shift`（MyFacilityShiftView）は独自グリッドで `ShiftGridFull` 不使用 → 影響なし
- `/api/shifts/transition`（公開フロー）: `shift_day_notes` は publish_status を持たない独立テーブルなので非連動
- シフト通知メール: 変更なし

---

## 3. 表出箇所マップ

| 場所 | 内容 |
|---|---|
| サイドバー/ナビ | 該当なし（新ページなし） |
| ダッシュボードのカード | 該当なし |
| 設定画面 | 該当なし（メモ行に設定項目なし） |
| シフト表（/admin/shifts, /mgr/shifts） | A: 日付ヘッダ直下にメモ2行（常時表示・インライン編集）。B: セル編集モーダルに「この日をコピー」ボタン + 貼り付けモード中は表上部にバナー（📋 アイコン + テキスト + 終了ボタン + Esc）。C: off セル/空セルに「○○ 勤務」バッジ、出勤系・休暇系セルに ⚠施設名マーカー + tooltip に時刻 |
| 印刷（A3 横 / window.print） | メモ2行は表の一部として印刷される（input の枠線は print CSS で消す）。バナー・モーダルは print-hide 相当（モーダルは閉じて印刷する運用） |
| 通知/トースト | B: 貼り付け成功はバナー内の件数カウンタで表示（トースト連打しない）。C: 出勤系の保存/貼り付け時に他施設重複の warning トースト（既存を共通化、am_off/pm_off も対象に拡張） |
| ロール別表示差 | admin / manager / shift_manager: 全機能可視。employee: いずれも非表示（RLS でも遮断） |
| モバイル/タブレット時 | グリッドは既存どおり横スクロール。メモ input・コピーボタン・バナーはタップ操作可。色のみに依存しない（⚠ アイコン + 施設名テキスト + tooltip） |

## 4. 連動更新ポイント

- [`shift_day_notes` テーブル追加] → `lib/types.ts`（ShiftDayNoteRow）/ `docs/reference-map.md` §0.18 / `docs/migration-applied.md` 219 行
- [`generateShift.ts` の空白日ルール変更] → `components/shift/ShiftFull.tsx`（handleGenerate は入出力互換・変更不要）/ `docs/shift-coverage-rule.md` は人数判定に非干渉のため変更なし（兼任は off になるので出勤数に数えない＝従来の full_time 誤カウントが解消する方向）
- [`crossFacilityWorkByCell` の型変更 `Map<string,string>` → `Map<string,{name,detail}>`] → `ShiftFull.tsx`（生成側）と `ShiftGridFull.tsx`（消費側）の両方を同時変更。他に利用箇所なし（grep 確認済み）
- [セル保存経路の共通化] → モーダル保存（handleSave）と貼り付け（pasteDay）の両方が `replaceShiftDay` + 重複警告 `warnCrossFacilityConflict` を通ること
- [reference-map 更新] → §0 適用済みマイグレーション最新番号を 219 に更新 + §0.18 追記

## 5. ロール別権限マトリクス（shift_day_notes）

| ロール | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| admin | ○（同テナント全施設） | ○（同テナント全施設） |
| manager | ○（get_my_managed_facility_ids の施設のみ） | ○（同左） |
| shift_manager | ○（get_my_managed_facility_ids の施設のみ） | ○（同左） |
| employee | ×（ポリシーなし） | × |

shift_assignments 側の権限は既存のまま（コピペは既存 RLS の範囲内の書き込み）。
他施設勤務の SELECT は既存 `sa_admin_all` / `sa_manager_cross_facility_select`（131/140）で全 publish_status 可視 — **RLS 変更不要**。

## 6. 既存機能との差分・依存

- `events` テーブル（127, 利用料金表のイベント実費）とは**別物**。メモ行は金額を持たない自由テキストで、請求に一切関与しない → 統合しない（理由: events は billing の列ヘッダとして参照されており、意味も画面も異なる）
- セルの `note`（職員×日, 40字）は残す。メモ行は「日単位・職員横断」で用途が異なる
- 生成ロジック変更の既存への影響: 本番データで「※金: 7月にパレット27日出勤 + 本部22日出勤」等の**兼任二重フル出勤が現に発生**しており、本変更はこれを解消する（兼任者は非主所属では空白日=off、勤務日は手動/コピペで設定）。主所属側の生成は従来どおり（=「本部の通常スケジュールはそのまま」の要望と一致）
- 生成済み月への影響: 生成をやり直した月から新ルール適用。公開済み月は再生成不可（既存ガード）のため遡及影響なし

## 7. 実装ルール

- メモ input は**非制御**（defaultValue + onBlur 保存）でグリッド全再レンダを避ける。maxLength 50、空文字保存は DELETE
- sticky 左列は既存 `.shift-grid-sticky-staff` / `.shift-grid-sticky-corner` クラスを再利用（opaque 背景必須 — 過去の sticky 透けバグの再発防止）
- 貼り付けモードは視覚バナー（アイコン+テキスト+ボタン）+ Esc で終了。音は使わない
- 公開済み（published）月はコピー・貼り付け・メモ以外のセル編集と同様に既存ガードで編集不可（メモ行のみ publish_status 非連動で常時編集可）
- コメントは「なぜ」を書く / console.log 残さない / any 禁止 / エラーメッセージは日本語

## 8. 完成条件

- [ ] migration 219 が本番 DB に適用され、INSERT/SELECT/RLS が probe で検証済み
- [ ] メモ: 入力→blur→リロードで残る / 空にすると行が消える / manager で自施設のみ / employee から不可視
- [ ] コピペ: 出勤(単発・分割)・公休・半休をコピーし別日に複製できる / Esc・終了ボタンで解除 / published 月では不可
- [ ] 生成: 兼任職員が非主所属施設で空白日=off になる / 主所属では従来どおり
- [ ] 相互反映: 他施設で draft の出勤を入れた日が、自施設グリッドの off セルに「○○ 勤務」、出勤セルに ⚠ で見える（リロード後）
- [ ] `npm run build` 通過 + dev で表示確認
- [ ] 異常系: メモ保存失敗時にエラー表示 / 貼り付け失敗時に alert / 空月ではグリッド自体が無効（既存挙動）

---

## 実装メモ（2026-07-03 実装完了）

- **migration 219 適用済**（`scripts/apply-migration-219.mjs`、pooler 経由）。upsert→onConflict update→delete を rollback 付きで実証。
- **A メモ行**: `ShiftGridFull` の tbody 先頭に `onDayNoteSave` があるときのみ 2 行描画。input は非制御（`key={noteKey_value}` + defaultValue + onBlur）。保存は `ShiftFull.handleDayNoteSave`（空文字→DELETE / それ以外→upsert）。印刷は `.day-note-input` の print CSS で枠を消す。
- **B コピペ（2026-07-03 右クリック方式に変更）**: 当初はモーダル起動＋左クリック貼り付けだったが「使いにくい／Excel 風が良い」との指摘（2026-07-03）で **セルの右クリックメニュー（コピー / 貼り付け）** に変更。
  - `ShiftGridFull` の `<td>` に `onContextMenu`（`e.preventDefault()` → `onCellContextMenu(staffId,date,x,y)`）。
  - `ShiftFull` が fixed 配置のメニューを描画: 「📋 コピー」（`buildCopiedDay` が非 null のセルのみ活性）/「📥 貼り付け（ラベル）」（`copiedDay` あり時のみ活性）。
  - **左クリックは従来どおり編集モーダル**（挙動不変＝既存操作を壊さない）。コピー元セルは破線 outline でマーキー表示。
  - コピー中バナー（右クリック→貼り付けを案内）+ Esc / 外側クリック / スクロールで閉じる。月/施設切替で `copiedDay` 解除。公開済み月は `handleCellContextMenu` と `pasteDay` の二重ガードで不可。
  - モーダル内は「💡 セルを右クリックでコピー/貼り付け」の導線ヒントのみ（コピーボタンは撤去）。
- **④ 相互反映**（判定は【時間が入っているか】= isAttended と同哲学。2026-07-03 先方指摘で確定）:
  - 「他施設勤務」バッジの真実源は **他施設セルの start_time が NOT NULL**（公休/希望休/有給/休みは時間 NULL なので他施設勤務に数えない）。
  - `generateShift.ts`: `isCrossFacility = s.facility_id && s.facility_id !== facilityId` を空白日 off 条件に追加（同一施設職員は挙動不変）。
  - fetch: `.not('start_time','is',null)` で時間ありの他施設勤務のみ取得（assignment_type 縛りは撤去）。publish_status フィルタなし（draft も取得）。値を `Map<string, CrossFacilityWork{name,detail}>` に集約。
  - 表示ルール（ShiftGridFull）:
    - 自施設が休(off)/未設定 + crossWork → 「○○ 勤務」バッジ
    - 自施設も時間あり(normal/am_off/pm_off) + crossWork → ⚠ 赤 二重アサイン警告
    - 自施設が公休/希望休/有給（時間なし）→ そのラベルのみ。**他施設バッジは出さない（空）**
    - 自施設・他施設ともに時間なし → 空
  - RLS 変更なし（`sa_manager_cross_facility_select` 131/140 が publish_status 無制限）。`scripts/probe-rls-cross-facility-draft.mjs` で manager が他施設 draft を RLS 越しに SELECT できることを実証。
- **想定外・注意点**:
  - コピペは 1 セルずつクリック方式（範囲ドラッグは未実装）。要望文の「コピー&ペースト」に対する最小充足。将来、複数日一括や勤務時間プリセット（②A 案）を足す余地あり。
  - ④ は「勤務のある月だけ兼任行を表示」までは含まない（要望④後半）。別途承認後に対応。
- **未実施**: 職員ログインでの UI 実操作確認（テスト資格情報が無く本セッションでは未実施）/ 本番 push（指示待ち）。

## 追補実装（2026-07-07）

先方フィードバックによる 3 点の追加対応。migration 220 適用済。

### ① 他施設勤務バッジを「現在所属している施設の勤務のみ」に限定
- 兼任(employee_facilities)を外しても過去の `shift_assignments` は残るため、`.neq(facility_id)` だけで拾うと外した施設の勤務バッジが残っていた（金田さん=主パズルのみで、パステル残存1行）。
- `ShiftFull.fetchAll` で各職員の現所属集合（主 `employees.facility_id` ∪ `employee_facilities`）を作り、cross 勤務を `memberFacilities.get(emp).has(a.facility_id)` で絞る。`scripts/probe-membership-filter-after.mjs` で除外を実証。

### ② メモ 2行 → 3行 + 行名称の変更（施設×月）
- migration 220: `shift_day_notes.row_no` を (1,2,3) に拡張 + 新テーブル `shift_day_note_labels(tenant,facility,month,row_no,label)`（219 と同型 RLS）。
- `ShiftGridFull`: `[1,2]`→`[1,2,3]`、左端セルを非制御 input のラベル編集に（onBlur upsert / 空は DELETE）。未設定は「メモN」表示。名称は月ごとに保存（`ShiftFull.handleDayNoteLabelSave` / fetch は `monthStr` で）。

### ③ AM休/PM休 で勤務時間・メモを編集可能に
- 従来固定だった半休時刻を編集可能に。モーダルの時刻入力欄・メモ欄を `am_off`/`pm_off` でも表示（分割トグルは通常出勤のみ）。
- `handleCellClick` が半休の保存済み時刻を復元、区分ボタン切替で半休の初期時刻（AM休=14:30-18:00 / PM休=09:30-13:30）をセット、`handleSave` が入力値で保存。DB 変更なし。
- **セル表示順（先方要望）**: 休む時間帯の位置に合わせて上下を並べる。AM休(午前休→午後勤務)=「AM休」を上・勤務時間を下。PM休(午後休→午前勤務)=勤務時間を上・「PM休」を下。`ShiftGridFull` に am_off/pm_off 専用分岐を追加。
- 未実施: 職員ログインでの UI 実操作確認（ユーザーがローカルで確認）。
