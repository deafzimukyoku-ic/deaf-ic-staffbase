# シフト「確認しました」機能 + 未確認赤バッジ

> **対象**: deaf-ic / diletto-new-staffbase（両 repo 同一）
> **起点**: パレット「6月公開したが職員が見れない」調査 → 派生要望
> **関連**: [shift-publish-notification-and-default-month.md](shift-publish-notification-and-default-month.md)（①既定月②通知③公開時職員通知）の続き
> **種別**: 新機能 + RLS（権限）拡張

---

## 1. 機能概要

- **機能名**: `shift-confirmation-and-badge`
- **目的**: 職員が「仮（ready）/ 公開（published）シフトを確認した」ことを明示ボタンで記録し、未確認なら他タブと同じ赤バッジで気付けるようにする。仮の段階からレビュー（案Z の本来の狙い）を機能させる。
- **スコープ（やる）**:
  - 施設シフトタブ（`MyFacilityShiftView`）を **ready でも施設全員分表示**（現状 published のみ）。ready は「仮（確認中）」と明示。
  - タブ内に **「✓ 確認しました」ボタン**（明示クリックで確認記録）。
  - **サイドバー「休み希望（+シフト）」nav** と **ダッシュボードのシフトカード** に未確認赤バッジ。
  - 管理者が **再 ready / 再公開** したら確認をリセット（= 最新版を再確認させる）。
  - **施設シフト表の社員並びを送迎表シフトと同じ `employees.shift_display_order ASC（NULLS LAST）→ 氏名` に統一**（職員管理 DnD の並びがそのまま反映される）。現状の「主所属施設順 → 氏名」から変更。
  - 新テーブル `shift_confirmations` + RLS + migration（deaf-ic 216 / diletto 201）。
- **スコープ（やらない）**:
  - 管理者向け「誰が確認したか」一覧 UI（将来）。本機能では確認記録の蓄積のみ。
  - draft 段階の表示（draft は従来どおり職員非表示）。
  - prev 月（過去月）の未確認バッジ計上（過去は確認不要 → 対象外）。
  - メール/Push 文面変更（既存 shift_ready / shift_publish のまま。本機能は in-app 確認のみ）。

---

## 2. 影響範囲（impact-catalog 該当項目のみ）

| # | 項目 | 具体 |
|---|---|---|
| 1 | DBスキーマ | 新テーブル `shift_confirmations(id, tenant_id, facility_id, employee_id, month, confirmed_count, confirmed_at)` + UNIQUE(employee_id, facility_id, month) |
| 2 | RLS / 権限 | (a) migration 160 `sa_employee_facility_shifts` を `publish_status='published'` → `IN ('ready','published')` に拡張 / (b) `shift_confirmations` の RLS 4 本（employee 本人 SELECT/INSERT/UPDATE、manager・admin の DELETE=リセット用） |
| 3 | マイグレーション | deaf-ic 216 / diletto 201。既存データ影響なし（新規テーブル + SELECT ポリシー拡張のみ）。バックフィル不要 |
| 4 | 型定義 | `lib/types.ts` に `ShiftConfirmationRow` 追加 |
| 5 | API / Server | `app/api/shifts/transition/route.ts`: ready/published 遷移時に `shift_confirmations` の (facility, 対象月) を delete（リセット）。確認の記録は client 直 upsert（RLS 本人 INSERT/UPDATE）で API 不要 |
| 10 | UI | `components/employee/MyFacilityShiftView.tsx`（ready 表示 + 「仮（確認中）」+ 確認ボタン）/ `app/(employee)/layout.tsx`（nav バッジ）/ `app/(employee)/my/dashboard/page.tsx`（カードバッジ）。確認ボタンは `ViewConfirmButton` の思想を踏襲した新 `components/shift/ShiftConfirmButton.tsx` |
| 13 | モバイル | バッジは既存と同じ Tailwind トークン（`bg-brand-red` 等）。確認ボタンはタブ内上部に固定配置（モバイルで見切れない） |
| 22 | ドキュメント | 本仕様書 / `docs/reference-map.md`（0.x 追記 + migration 表）/ `docs/migration-applied.md`（両 repo）/ `docs/error-log.md`（RLS 拡張の検証メモ） |

**constraints.md 照合**: §1（動画 proxy）無関係。§2（pooler 接続）→ apply script は既存パターン踏襲で遵守。**抵触なし。**

---

## 3. 表出箇所マップ（空欄禁止）

| 場所 | 内容 |
|---|---|
| サイドバー / nav | `app/(employee)/layout.tsx` の `tabs` で `/my/requests`（「休み希望（+シフト）」）に `unreadKey: 'shift'` を追加。未確認の (facility, 月) 件数を赤バッジ表示（this/next 月のみ計上） |
| ダッシュボードのカード | `app/(employee)/my/dashboard/page.tsx` の「シフト」カードに赤バッジ（未確認件数）。既存 `hasUnread` ロジックに shift を追加 |
| 設定画面 | 該当なし |
| 通知 / トースト / モーダル | 確認ボタン押下時に `toast.success('確認を記録しました')`。モーダルではなくタブ内インライン |
| ヘッダー / フッター / パンくず | 該当なし |
| ロール別表示差 | 確認ボタン・バッジは **employee のみ**（admin/manager が自分の `/my` を見るときも employee 扱いで表示はされるが、対象は本人の確認状況）。shift_manager は対象外（職員ではないため /my を主に使わない）。本機能は role 判定でなく「本人の shift_confirmations」基準なので自然に分離 |
| モバイル時 | バッジ・ボタンとも上記モバイル方針。施設シフト表は既存どおり横スクロール |

---

## 4. 連動更新ポイント（空欄禁止 / 「など」禁止）

- `[shift_confirmations テーブル追加]` → `supabase/migrations/216_shift_confirmations.sql`(deaf-ic) / `201_*`(diletto) + `scripts/apply-migration-216.mjs` / `apply-migration-201.mjs` + `docs/migration-applied.md` 両 repo + `lib/types.ts` の `ShiftConfirmationRow`
- `[migration 160 の RLS 拡張]` → `supabase/migrations/216_*`（同 migration 内で `sa_employee_facility_shifts` を drop & recreate、ready 追加）+ `components/employee/MyFacilityShiftView.tsx` のクエリを `.in('publish_status', ['ready','published'])` に + `scripts/probe-*` で employee 視点 SELECT 再現確認
- `[確認ボタン押下]` → `components/shift/ShiftConfirmButton.tsx`（`shift_confirmations` upsert）→ `notifyBadgeRefresh()` → `app/(employee)/layout.tsx` の `listenBadgeRefresh(loadCompany)` が再 fetch → nav バッジ即時減
- `[nav バッジ算出]` → `app/(employee)/layout.tsx` `loadCompany()` の `Promise.all` に shift_assignments(ready/published, this+next 月) + shift_confirmations を追加 → `UnreadKey` に `'shift'` 追加 → `setUnread` に `shift` 追加
- `[ダッシュボードカードバッジ]` → `app/(employee)/my/dashboard/page.tsx` のシフトカード `TodoItem` に `shiftUnconfirmed?: number` 追加 → カード描画の `hasUnread`/`badgeCount` 分岐に shift を追加
- `[管理者の ready / published 遷移]` → `app/api/shifts/transition/route.ts` の通知 enqueue ブロックで `shift_confirmations` の (tenant, facility, year-month) を delete（target が ready/published のときのみ）
- `[型変更]` → `lib/types.ts` → `docs/reference-map.md` の型参照 + registry
- `[reference-map / progress.html]` → 0.x セクション追記 + migration 表に 216/201

---

## 5. ロール別権限マトリクス

| 操作 | employee（本人） | manager | shift_manager | admin |
|---|---|---|---|---|
| 施設の ready シフト閲覧（施設全員分） | ✅ 自所属(主+兼任)施設のみ | ✅（既存 manager ポリシー） | ✅（既存） | ✅ |
| 施設の published シフト閲覧 | ✅ 自所属施設（既存 160） | ✅ | ✅ | ✅ |
| `shift_confirmations` 自分の確認を記録（INSERT/UPDATE） | ✅ 本人 × 自所属施設 × 対象月 | ―（自分の /my では可だが対象外運用） | ― | ― |
| `shift_confirmations` SELECT | ✅ 本人分のみ | ❌（本機能では不可。将来「誰が確認したか」で追加） | ❌ | ❌（同左） |
| `shift_confirmations` DELETE（リセット） | ❌ | ✅ 自管轄施設分 | ❌ | ✅ テナント内 |
| 確認バッジ表示 | ✅ | （自 /my 閲覧時のみ） | ― | （自 /my 閲覧時のみ） |

- shift_manager は職員確認の対象外（/my を主用途にしない）。manager_facilities は使わず、RLS は `get_my_managed_facility_ids()` を踏襲。

---

## 6. 既存機能との差分・依存

- **類似機能**: お知らせ/遵守/研修/マニュアルの「確認しました」(`ViewConfirmButton` + `{category}_view_logs`)。**思想は踏襲するが別テーブル**（シフトは「月×施設」単位で version 概念が無く、リセットは管理者操作起点のため、append-only view_logs ではなく upsert + 管理者 delete が素直）。
- **依存先**:
  - `lib/badge-refresh.ts`（`notifyBadgeRefresh` / `listenBadgeRefresh`）— そのまま利用
  - migration 160 `sa_employee_facility_shifts`（拡張対象）/ 130 `get_my_facility_ids()` / `get_my_managed_facility_ids()`
  - `lib/multi-facility.ts` `fetchMyFacilityIds`（既に MyFacilityShiftView / layout / dashboard で使用）
- **この変更で影響を受ける既存機能**:
  - `MyFacilityShiftView`: 「まだ公開されていません」の出方が変わる（ready があれば仮表示）。`facility-shift-month-navigation.md` の月送り仕様は不変。
  - shift_ready メールのリンク先（`/my/requests?tab=facility-shift`）が **ready でも中身が見える**ようになり、メールの導線が初めて機能する（既存ギャップの解消）。

---

## 7. 実装ルール

- 命名: テーブル `shift_confirmations`（snake_case 複数形）/ 型 `ShiftConfirmationRow`（PascalCase）/ コンポーネント `ShiftConfirmButton`（PascalCase）/ migration `216_shift_confirmations.sql`。
- 再利用: 確認ボタンは `ViewConfirmButton.tsx` の構造（`useState` + `createClient` + `toast` + `notifyBadgeRefresh()`）を踏襲。バッジ描画は layout / dashboard の既存赤バッジ markup（`bg-brand-red text-white rounded-full`）をそのまま使う（新トークン追加禁止）。
- RLS: `tenant_id` チェック必須。employee は `employee_id = (auth の employees.id)` かつ `facility_id in get_my_facility_ids()`。manager は `facility_id in get_my_managed_facility_ids()`。
- モバイル: 既存レスポンシブ方針踏襲。確認ボタンはタブ上部、横スクロール表の外に置く。
- 破壊的変更の禁止（CLAUDE.md §7）: 既存 migration は触らない（160 は **新 migration 内で drop & recreate**）。`publish_status='published'` の自動上書きはしない（本機能は SELECT 拡張のみ、書込なし）。

---

## 8. 完成条件

**正常系**
- [ ] manager が ready にすると、施設職員のサイドバー「休み希望（+シフト）」とダッシュボードカードに赤バッジが出る
- [ ] 職員が施設シフトタブを開くと **ready シフトが施設全員分** 見え、「仮（確認中）」と分かる
- [ ] 「✓ 確認しました」を押すと `shift_confirmations` に記録され、トースト + バッジが**即時に**消える（`notifyBadgeRefresh`）
- [ ] published 後も同様に未確認→確認でバッジ制御できる
- [ ] manager が再 ready / 再公開すると確認がリセットされ、バッジが再点灯する

**異常系 / 境界**
- [ ] draft の月は職員に見えない・バッジも出ない
- [ ] 過去月（prev）はバッジ計上しない
- [ ] 兼任職員: 複数施設の未確認が正しく合算され、各施設分の確認が記録される
- [ ] email/Push 未登録でも in-app バッジは機能する（独立）
- [ ] RLS 拡張で「全員ログアウト」等の認証副作用が出ない（employee 視点 probe で SELECT 再現、ログイン無影響を確認）

**ローカル確認**
- [ ] deaf-ic（port 6001）で職員ログイン → 上記正常系
- [ ] 型チェック 0 エラー（両 repo）/ 変更ファイル eslint 新規エラーなし
- [ ] migration apply script の before/after で RLS 拡張・テーブル作成を実証

**将来対応（本機能では分離）**
- 管理者向け「確認状況一覧（誰が未確認か）」
- 確認リマインド通知

---

## 9. 実装メモ（2026-05-31 実装・両 repo 適用済）

- **migration**: deaf-ic 216 / diletto 201 を本番適用済。apply script の検証で「テーブル + RLS 5本 + 160 ready 拡張」を確認。deaf-ic は実 employee の JWT 注入 probe で **published 6月=318件（回帰なし）** を確認 → RLS 拡張に認証副作用なし。
- **確認単位**: `(employee_id, facility_id, month)` UNIQUE。確認ボタンは当月に ready/published のある施設ぶんを一括 upsert（`onConflict: employee_id,facility_id,month`、`confirmed_at` のみ更新）。
- **バッジ窓**: nav / dashboard とも **今月 + 来月** の (施設,月) を対象。`shift_assignments`(ready/published) ∖ `shift_confirmations` の差集合件数。月窓上限は翌々月 1 日の排他境界（`.lt`）で月末日問題を回避。
- **リセット**: `app/api/shifts/transition` の ready/published 遷移時に当該 (tenant, facility, month) の `shift_confirmations` を delete（`ctx.supabase` = manager/admin、RLS の `sc_*_delete` で許可）。
- **即時反映**: `ShiftConfirmButton` 押下 → `notifyBadgeRefresh()` → layout の `listenBadgeRefresh(loadCompany)` 再 fetch でバッジ即時減。
- **並び順（追加要件）**: `MyFacilityShiftView` の社員並びを送迎表と同じ `shift_display_order ASC（NULLS LAST）→ 氏名` に変更（施設順で兼任グループ化は維持）。職員管理 DnD（`StaffSettingsFull` → `reorder_staff_shift_orders` / `shift_display_order`）の並びがそのまま反映。
- **検証**: 両 repo `tsc --noEmit` 0 エラー / 変更ファイル eslint 新規エラーなし（既存 any 2件・unused 2件・hook dep 系は変更外）。deaf-ic dev(6001) で全ルート 200/307 コンパイル成功。
- **既知の非対象**: 仮シフトの職員可視化は「施設全員分」（ユーザー承認）。確認は主所属+兼任施設の本人記録。管理者向け確認状況一覧は将来。
