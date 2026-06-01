# 職員のシフト変更申請（提出UI 復活）

> **対象**: deaf-ic / diletto-new-staffbase（両 repo 同一）
> **起点**: 「希望の変更はシフト変更申請で行ってください」バナーが、入口の無い機能を案内していた（提出UIが commit `5c274a9` で撤廃済）
> **種別**: 機能追加（UIのみ。DB / RLS / 承認API は既存で流用）

---

## 1. 機能概要

- **機能名**: `shift-change-request-employee`
- **目的**: 公開（published）/ 仮（ready）シフトに対して、職員が「時刻変更 / 休暇申請 / 勤務種別変更」を申請できる提出UIを復活させ、管理者の承認キュー（`ApprovalQueueFull`）に乗せる。案Z（職員が仮シフトをレビュー→申請→公開）の本来フローを成立させる。
- **スコープ（やる）**:
  - 施設シフトタブ（`MyFacilityShiftView`）で **自分の行のセル（日付）をクリック → 変更申請モーダル**。
  - 撤廃された `ShiftChangeRequestForm.tsx` を現構造に再追加（直接 `shift_change_requests` へ INSERT。RLS `scr_insert` で本人のみ可）。
  - 対象は **ready / published 両方**（仮の段階からレビュー＝案Z の狙い）。draft は職員非表示なので対象外。
  - 申請可能なのは **自分の行のみ**（他人のセルはクリック不可のまま）。
  - `MyRequestsView` の「希望の変更はシフト変更申請で」バナーを、施設シフトタブの操作へ正しく誘導する文言に修正。
- **スコープ（やらない）**:
  - 新規 API ルート（直接 INSERT で足りる。承認は既存 PATCH `[id]` ルート）。
  - migration / RLS 変更（`shift_change_requests` テーブル + `scr_*` ポリシーは既存）。
  - 申請の取り消し（cancelled）UI / 申請履歴一覧（将来）。
  - セルへの「申請中」インジケータ（将来。本フェーズはトーストのみ）。

---

## 2. 影響範囲（impact-catalog 該当項目のみ）

| # | 項目 | 具体 |
|---|---|---|
| 2 | RLS / 権限 | **変更なし**。`scr_insert`（migration 131）が `employee_id = 本人` の INSERT を許可済 |
| 4 | 型定義 | **変更なし**。`ShiftChangeRequestType` / `ShiftChangeRequestPayload` / `ShiftChangeRequestRow`（lib/types.ts）既存 |
| 5 | API | **新規なし**。提出は client 直 INSERT。承認は既存 `app/api/shifts/shift-change-requests/[id]/route.ts`（PATCH, admin のみ） |
| 6 | バリデーション | フォーム側で時刻 `HH:MM` 形式チェック / reason 200字上限（旧フォーム踏襲） |
| 10 | UI | `components/shift/ShiftChangeRequestForm.tsx`（再追加）/ `components/employee/MyFacilityShiftView.tsx`（自分セルクリック→モーダル）/ `components/shift/MyRequestsView.tsx`（バナー文言） |
| 13 | モバイル | モーダルは `shift-compat/Modal`（既存）。タッチで開閉。表は既存の横スクロール |
| 22 | ドキュメント | 本仕様書 / `docs/reference-map.md` / `docs/progress.html` |

**constraints.md 照合**: §1（動画）§2（pooler）とも無関係。**抵触なし。**

---

## 3. 表出箇所マップ（空欄禁止）

| 場所 | 内容 |
|---|---|
| サイドバー / nav | 該当なし（新規ナビ追加なし） |
| ダッシュボードのカード | 該当なし（本フェーズでは申請カウント表示はしない） |
| 設定画面 | 該当なし |
| 通知 / トースト / モーダル | **モーダル**: `ShiftChangeRequestForm`（申請種別ラジオ + 時刻/休暇種別/種別変更の入力 + 理由）。**トースト**: 送信成功で「変更申請を送信しました」 |
| ヘッダー / フッター / パンくず | 該当なし |
| ロール別表示差 | **employee**: 自分の行セルがクリック可 → モーダル。**admin/manager/shift_manager** が `/my` を見る場合も同様（本人の行のみ）。承認側は既存 `ApprovalQueueFull`（admin のみ承認ボタン、manager 閲覧） |
| モバイル時 | モーダルは画面幅に追従（`shift-compat/Modal` 既存挙動）。セルのタップ領域は既存セルサイズ |

---

## 4. 連動更新ポイント（空欄禁止 / 「など」禁止）

- `[ShiftChangeRequestForm 再追加]` → `components/shift/ShiftChangeRequestForm.tsx`（deaf-ic=`brand-*` / diletto=`diletto-*` のカラークラスで再生成。旧版は git `5c274a9^` から復元）
- `[施設シフトで自分セルをクリック]` → `components/employee/MyFacilityShiftView.tsx`: 自分の行(`e.id === employeeId`)のセルに `onClick` + `cursor-pointer` を付与。`monthStage`（ready/published）のときのみ有効。クリックで `{ targetDate, currentShift }` を state にセットしモーダルを開く
- `[モーダル送信]` → `ShiftChangeRequestForm` が `supabase.from('shift_change_requests').insert(...)` → `onSubmitted` で toast → モーダル閉じる（赤バッジ等の再 fetch は不要：申請は確認状態を変えない）
- `[バナー文言]` → `components/shift/MyRequestsView.tsx`: 「📌 この月は既にシフトが作成されています。希望の変更はシフト変更申請で行ってください。」→ 施設シフトタブでの操作に誘導する文言へ
- `[承認側]` → 変更なし（`components/shift/ApprovalQueueFull.tsx` + `app/api/shifts/shift-change-requests/[id]/route.ts` が pending を承認/却下 → 承認時 `shift_assignments` を更新。既に `ShiftFull.tsx` で admin に描画済）
- `[ドキュメント]` → `docs/reference-map.md` の 0.x 追記 + `docs/progress.html` フェーズ追加

---

## 5. ロール別権限マトリクス

| 操作 | employee（本人） | manager | shift_manager | admin |
|---|---|---|---|---|
| 施設シフトで自分の勤務をタップ→申請 | ✅ 自分の行 × ready/published | ✅（自分の /my 行のみ。運用上は稀） | ✅（同左） | ✅（同左） |
| 他人の勤務に申請 | ❌ | ❌ | ❌ | ❌ |
| `shift_change_requests` INSERT | ✅ 本人（RLS `scr_insert`） | ✅ 本人 + 管轄職員（既存 RLS） | ✅ 本人 | ✅ |
| 承認 / 却下（既存 `ApprovalQueueFull`） | ❌ | ❌（閲覧のみ） | ❌ | ✅（出勤中 admin） |

- 承認 API（`[id]` PATCH）は `allowedRoles: ['admin']`。本機能で変更しない。

---

## 6. 既存機能との差分・依存

- **復元元**: git `5c274a9^:components/shift/ShiftChangeRequestForm.tsx`（撤廃前の完全版）。フィールド・payload 構造・INSERT ロジックをそのまま流用し、カラークラスのみ現行に合わせる。
- **依存（すべて既存・無改造）**:
  - DB: `shift_change_requests`（target_date / change_type / requested_payload / snapshot_before / reason / status）
  - RLS: `scr_insert`（migration 131）
  - 承認: `ApprovalQueueFull.tsx` + `/api/shifts/shift-change-requests/[id]`（approve で `shift_assignments` を更新）
  - UI 部品: `components/shift-compat/Modal`, `Button`
- **この変更で影響を受ける既存機能**:
  - `MyFacilityShiftView`: これまで完全読み取り専用 → 自分の行のみクリック可に（他行・表示は不変）。確認バッジ機能（migration 216）とは独立（申請は確認状態を変えない）。

---

## 7. 実装ルール

- 命名: 既存 `ShiftChangeRequestForm`（PascalCase）を踏襲。
- 再利用: 旧フォームの構造（種別ラジオ + payload 入力 + 理由 + `shift-compat/Modal`/`Button`）をそのまま。`createClient` 直 INSERT。
- カラートークン: deaf-ic は `brand-*`、diletto は `diletto-*`（旧版は diletto- だった点に注意。deaf-ic 側は brand- に置換）。新トークンは作らない。
- 公休（public_holiday）は職員の申請選択肢に出さない（管理者専用。旧版踏襲）。
- モバイル: モーダル既存挙動。エラーは入力欄下に日本語表示（旧版踏襲）。

---

## 8. 完成条件

**正常系**
- [ ] 職員が施設シフトタブで **自分の行の勤務セルをタップ** → 変更申請モーダルが開く（対象日 + 現状シフトが表示）
- [ ] 「時刻変更 / 休暇申請 / 勤務種別変更」のいずれかで申請 → `shift_change_requests` に pending で INSERT → トースト
- [ ] 管理者の `ApprovalQueueFull`（シフト表）に申請が表示され、**承認で `shift_assignments` が更新**される
- [ ] `MyRequestsView` のバナーが施設シフトタブの操作へ正しく誘導している

**異常系 / 境界**
- [ ] 他人の行のセルはクリックできない（申請不可）
- [ ] draft 月（職員非表示）では申請導線が出ない
- [ ] 時刻が `HH:MM` でないと送信前にエラー
- [ ] ネット/RLS エラー時はモーダル内に日本語エラー表示（握り潰さない）
- [ ] 兼任職員: 表示中の施設・自分の行で申請でき、facility_id が正しく入る

**ローカル確認**
- [ ] deaf-ic（port 6001）で職員ログイン → 上記正常系
- [ ] 型チェック 0 エラー（両 repo）/ 変更ファイル eslint 新規エラーなし

**将来対応（本フェーズでは分離）**
- 申請中セルのインジケータ / 自分の申請履歴一覧 / 申請取消（cancelled）UI
- 申請提出時に管理者へ通知（メール/Push）

---

## 9. 実装メモ（2026-06-01 実装・両 repo）

- **新規 migration / API / RLS なし**。`ShiftChangeRequestForm.tsx` は git `5c274a9^` から復元し、deaf-ic=`brand-*` / diletto=`diletto-*` に置換 + 送信成功トースト（sonner）を追加。提出は `supabase.from('shift_change_requests').insert(...)` 直 INSERT（RLS `scr_insert`）。
- **入口**: `MyFacilityShiftView` の `dateList.map` 内で `isOwn = e.id === employeeId` を判定し、自分の行のセルに `onClick={openChangeRequest(date, cell)}` + `cursor-pointer hover:ring` を付与。空セル（未設定）も申請可（currentShift=null）。`openChangeRequest` は `facilityId = cell.facility_id ?? facilityId`（兼任時の施設特定）。
- **対象段階**: monthStage（ready/published）が出ている＝表が描画されている月のみセルがクリック可。draft は職員非表示なので自然に対象外。
- **モーダル**: `changeReq` state で `{date, facilityId, currentShift}` を保持し `ShiftChangeRequestForm` を描画。`onSubmitted` は no-op（フォームが toast + onClose を担当）。
- **discoverability**: 凡例下に「💡 自分の勤務をタップすると変更申請できます」ヒント + 各自セルの `title`。`MyRequestsView` の締切バナーも「施設のシフト」タブへ誘導する文言に修正。
- **承認ループ**: 既存 `ApprovalQueueFull`（`ShiftFull` に admin 描画済）+ `PATCH /api/shifts/shift-change-requests/[id]`（approve で `shift_assignments` 更新）。無改造で機能。
- **検証**: 両 repo `tsc --noEmit` 0 エラー / 変更ファイル eslint 新規エラーなし。
