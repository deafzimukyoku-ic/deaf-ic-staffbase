# shift-manager-children-staff-edit

> ステータス: 承認済・実装完了（2026-05-28）。職員編集は migration 214 の RPC 経由、児童編集は RLS 既許可分のフロント解除。施設セレクタ・社員画面リンクは shift_manager / 兼務なし manager で非表示化。

## 1. 機能概要

- 機能名: `shift-manager-children-staff-edit`
- 目的: `shift_manager`（シフト統括 / 事業所共用端末 / migration 140）が、シフト・送迎モード内の **児童管理（`/admin/children`）** と **職員管理（`/admin/shifts/staff-settings`）** を、閲覧だけでなく **追加・編集・削除・並び替え**できるようにする。マネージャー不在の現場で、児童登録やシフト用の職員設定を端末だけで完結させるため。
- 現状: どちらの画面でも操作しようとすると `assertWritable()` が `shift_manager` を弾き、`alert('権限がありません\n\n事業所の管理者または本部に変更をお願いしてください')` が出る。

### スコープ

**やる:**
- `ChildrenSettingsFull.tsx`: `shift_manager` の編集ブロックを解除（児童 RLS は **既に shift_manager 許可済み**＝probe確認済、変更不要）
- `StaffSettingsFull.tsx`: `shift_manager` の編集ブロックを解除。ただし `employees` 更新は **SECURITY DEFINER RPC 経由**にして、`shift_manager` が触れるカラムを **シフト系9項目＋並び順** に限定
- 操作範囲は **自 facility のみ**（`get_my_managed_facility_ids()` 準拠。shift_manager は主所属1施設）
- ヘッダー右の **施設セレクタ（施設移動トグル）** を「アクセス可能施設が1つ（＝兼務なし）なら非表示」に統一。shift_manager（`app/(admin)/layout.tsx`、主所属1施設）と兼務なし manager（`app/(manager)/layout.tsx`）で消える。admin は全施設のため残る
- `app/(admin)/layout.tsx`: ヘッダーの **「社員画面」リンク** を shift_manager には表示しない（押しても middleware で `/admin/shifts/dashboard` に弾かれる無意味なリンクのため）

**やらない:**
- 社員管理本体（`/admin/employees`・社員モード）への shift_manager アクセス許可 → 従来どおり middleware で遮断
- `employees` の **氏名・連絡先・給与・`role`** カラムの編集 → RPC から除外（**権限昇格の防止**）
- 児童 RLS の変更（`children_manager_facility [ALL]` が既に shift_manager を含む。触らない）
- `BulkPublishButtons`（研修/お知らせ/マニュアル/遵守事項の一括公開。社員モード専用で shift_manager は到達不可）→ スコープ外
- 事業所設定（`FacilitySettingsFull`）→ 既にガード無し・RLS 許可済みで shift_manager 編集可。変更不要
- manager / admin の児童・職員編集の既存動作 → 不変（直接 update を維持。RPC は shift_manager 経路のみ）
- admin の施設セレクタ → 従来どおり全施設を表示（スコープ無制限のため絞らない）

---

## 2. 影響範囲

### データ層
- `children`: **変更なし**。実DB probe で `children_manager_facility [ALL]` に `shift_manager` 確認済（`USING: get_my_role() IN ('manager','shift_manager') AND tenant一致 AND facility_id IN get_my_managed_facility_ids()`）。`for all` の USING が INSERT の CHECK に流用されるため追加・編集・削除が通る。
- `employees`: 実DB probe で UPDATE 系ポリシーは `manager_manage_subordinates`（manager限定）/ `employee can update self` のみ。**shift_manager 用が無い**ため直接 update は RLS で 0 件更新になる。→ 新規 RPC を追加（`employees` の RLS ポリシー自体は変更しない）。

### サーバー層
- 新規 migration `214_shift_manager_staff_edit_rpc.sql`（200番台 → `docs/migration-applied.md` 記録対象）＋ `scripts/apply-migration-214.mjs`
  - RPC `update_staff_shift_fields(...)`: 雇用形態・勤務時間・送迎エリア・資格系の9カラムのみ更新
  - RPC `reorder_staff_shift_orders(p_ordered_ids uuid[])`: `shift_display_order` を一括更新
  - 両 RPC とも SECURITY DEFINER。内部で「呼び出し者 role ∈ (admin, manager, shift_manager)」「対象 employee の facility が自管轄（admin はテナント一致）」を検証

### クライアント層
- `components/shift/ChildrenSettingsFull.tsx`: `assertWritable()` 定義（L105-109付近）と呼び出し4箇所（L217 / L248 / L285 / L376）を削除（shift_manager 専用ブロックのため関数ごと不要）
- `components/shift/StaffSettingsFull.tsx`:
  - `assertWritable()` 定義（L238-242）と呼び出し3箇所（L338 / L359 / L402）を削除
  - `handleSave`（L364 の `from('employees').update`）: `shift_manager` のとき `supabase.rpc('update_staff_shift_fields', {...})`、それ以外は既存の直接 update を維持
  - `handleReorderStaff`（L410 の更新ループ）: `shift_manager` のとき `supabase.rpc('reorder_staff_shift_orders', { p_ordered_ids })`、それ以外は既存ループを維持
- `app/(admin)/layout.tsx`（admin と shift_manager が使用）:
  - `facilities` の取得（L399-406付近）を role 別に絞る: admin=テナント全施設（現状維持）/ shift_manager=主所属1施設のみ
  - 施設セレクタの表示条件 `mode === 'shift' && facilities.length > 1`（L490 / L524）はそのまま。shift_manager は1施設になり自動で非表示、admin は複数なら表示
  - 「社員画面」`<Link href="/my/dashboard">`（L501 / L535）を `!isShiftManager` で条件表示（admin は残す）
- `app/(manager)/layout.tsx`（manager が使用）:
  - `facilities` は既に `manager_facilities` + 主所属で自管轄のみ取得済み（取得ロジックは変更不要）
  - `FacilityHeaderSelector`（L315）の非表示条件を `facilities.length === 0` から `facilities.length <= 1` に変更（兼務なし＝1施設でセレクタが消える）
  - 「社員画面」リンク（L521 / L545）は **manager では維持**（manager は employee 画面に切替可のため）

### 横断
- `docs/reference-map.md` に本機能（RPC 名・対象テーブル・ロール）を追記
- `docs/migration-applied.md` に 214 を記録（適用後）

---

## 3. 表出箇所マップ

| 箇所 | 内容 |
|---|---|
| サイドバー / ナビ | 児童管理・職員管理リンクは既に表示済み（操作可否のみ変更）。**ヘッダー右の施設セレクタ**を shift_manager / 兼務なし manager で非表示化 |
| ダッシュボードのカード | 該当なし |
| 設定画面の項目 | 該当なし（事業所設定は別画面・変更しない） |
| 通知・トースト・モーダル | ✅ 児童/職員の保存成功・失敗トースト（既存）が shift_manager でも出る。`alert('権限がありません…')` は shift_manager に **出なくなる** |
| ヘッダー・フッター・パンくず | ✅ ヘッダー右の「社員画面」リンクを shift_manager で非表示 |
| ロール別の表示差異 | shift_manager で「＋児童追加」「送迎エリアを設定」「職員編集」「並び替え」が活性化。施設セレクタは shift_manager と兼務なし manager で非表示。社員画面リンクは shift_manager のみ非表示（manager は維持）。admin は両方表示 |
| モバイル時の表示 | 既存レイアウト踏襲（`overflow-x-auto`）。表示は不変、活性化のみ |

---

## 4. 連動更新ポイント

| トリガー | 連動して触るファイル / 関数 |
|---|---|
| 児童編集ブロック解除 | `ChildrenSettingsFull.tsx`: `assertWritable` 定義削除 + 呼び出し L217/248/285/376 削除 |
| 職員編集ブロック解除 | `StaffSettingsFull.tsx`: `assertWritable` 定義削除 + 呼び出し L338/359/402 削除 |
| 職員シフト項目の保存 | `StaffSettingsFull.tsx` `handleSave` を shift_manager 分岐で `update_staff_shift_fields` RPC に |
| 職員並び替え | `StaffSettingsFull.tsx` `handleReorderStaff` を shift_manager 分岐で `reorder_staff_shift_orders` RPC に |
| employees 更新権限の付与 | `supabase/migrations/214_shift_manager_staff_edit_rpc.sql` + `scripts/apply-migration-214.mjs` |
| 施設セレクタの絞り込み（shift_manager） | `app/(admin)/layout.tsx` facilities 取得（L399-406）+ セレクタ条件（L490 / L524） |
| 施設セレクタの非表示（兼務なし manager） | `app/(manager)/layout.tsx` `FacilityHeaderSelector`（L315）の表示条件を `length <= 1` で非表示に |
| 社員画面リンクの非表示（shift_manager） | `app/(admin)/layout.tsx` `<Link href="/my/dashboard">`（L501 / L535）を `!isShiftManager` で条件化 |
| 適用記録 | `docs/migration-applied.md` に 214 を追記 |
| 参照台帳 | `docs/reference-map.md`（RPC 名 / 対象 employees カラム / ロール参照セクション） |

対象ファイル一覧:
- `components/shift/ChildrenSettingsFull.tsx`
- `components/shift/StaffSettingsFull.tsx`
- `app/(admin)/layout.tsx`
- `app/(manager)/layout.tsx`
- `supabase/migrations/214_shift_manager_staff_edit_rpc.sql`
- `scripts/apply-migration-214.mjs`
- `docs/reference-map.md`
- `docs/migration-applied.md`

---

## 5. ロール別権限マトリクス（シフト・送迎モード内）

| 操作 | admin | manager | shift_manager（変更後） | employee |
|---|---|---|---|---|
| 児童 閲覧 | ✅ 全 | ✅ 自facility | ✅ 自facility | ✅ 閲覧のみ |
| 児童 追加 / 編集 / 削除 / 並び替え | ✅ | ✅ 自facility | ✅ 自facility（**新規許可**） | ❌ |
| 職員 シフト系9項目の編集 | ✅ | ✅ subordinate | ✅ 自facility・**RPC経由**（新規許可） | ❌ |
| 職員 並び替え（shift_display_order） | ✅ | ✅ | ✅ 自facility・RPC経由（新規許可） | ❌ |
| 職員 氏名・連絡先・給与・`role` の編集 | ✅ | ✅(subordinate) | ❌（RPC に引数なし） | 自分の一部のみ別画面 |
| 社員管理本体 `/admin/employees`（社員モード） | ✅ | ❌ | ❌（middleware で遮断） | ❌ |

shift_manager が編集できるシフト系9項目: `employment_type` / `default_start_time` / `default_end_time` / `pickup_transport_areas` / `dropoff_transport_areas` / `shift_qualifications` / `is_qualified` / `is_driver` / `is_attendant`。

---

## 6. 既存機能との差分・依存

- **既存**: shift_manager は児童・職員を閲覧のみ可（`assertWritable` で書き込みブロック）。RLS は children だけ既に許可済み、employees は未許可。
- **差分**: 自 facility 内で児童は直接、職員はシフト系項目のみ RPC 経由で編集可に。
- **依存**: `get_my_managed_facility_ids()`（既存・SECURITY DEFINER）/ `children_manager_facility` RLS（既存）/ 新規 RPC 2本。
- **影響を受ける既存機能**: 児童・職員編集は不変（manager/admin は従来の直接 update、RPC 経路は shift_manager のみ）。施設セレクタは (1) shift_manager で非表示化 (2) 兼務なし manager で非表示化（manager の `facilities` は元々自管轄取得のため表示条件のみ変更）。admin は不変。

---

## 7. 実装ルール

- `components/ui/*` は変更しない
- RPC 命名: `update_staff_shift_fields` / `reorder_staff_shift_orders`（snake_case）
- RPC は **SECURITY DEFINER** + 関数先頭で `get_my_role()` と対象 facility を検証。許可されない場合は `raise exception`（フロントは既存 try/catch でトーストに出す）
- RPC は **9カラム＋並び順以外を一切 UPDATE しない**（`role`・給与・氏名は SQL に登場させない＝昇格不能）
- フロントは「shift_manager のときだけ RPC、それ以外は既存 update」の最小分岐（manager/admin のコードパスを変えない）
- 児童側は `assertWritable` ごと削除（デッドコードを残さない）
- ユーザー向けメッセージ・トーストは日本語、既存文言を踏襲
- 実装順序: ① migration 214 作成＋適用 → ② StaffSettingsFull を RPC 化 → ③ 両ファイルの `assertWritable` 解除（順序を守らないと shift_manager が一時的に RLS エラーに当たる）

---

## 8. 完成条件

### 正常系（`npm run dev`、shift_manager / manager / admin の3ロールで確認）
- [ ] shift_manager で児童を追加 → 保存され一覧に出る
- [ ] shift_manager で児童を編集・削除・並び替えできる
- [ ] shift_manager で職員のシフト系項目（勤務時間・送迎エリア・資格・雇用形態）を編集 → 保存できる
- [ ] shift_manager で職員を並び替えできる
- [ ] manager / admin の児童・職員編集が従来どおり動く（リグレッションなし）
- [ ] shift_manager のヘッダーに施設セレクタが出ない（主所属1施設）／「社員画面」リンクが出ない
- [ ] 兼務あり manager は施設セレクタが残り、兼務なし manager は消える
- [ ] admin は施設セレクタ・社員画面リンクとも従来どおり表示

### 異常系・境界値
- [ ] shift_manager が他 facility の児童・職員を操作不可（RLS / RPC で拒否）
- [ ] セレクタ非表示でも URL / localStorage 経由で他 facility を指定した場合に RLS / RPC で空になり閲覧・編集できない
- [ ] RPC に `role`・給与・氏名の引数が無く、shift_manager が権限昇格や個人情報改変をできない
- [ ] 旧 alert「権限がありません」が shift_manager に出ない（admin/manager 経路でも誤爆しない）

### 確認
- [ ] `npm run build` パス
- [ ] 実装直前に `node scripts/probe-shift-manager-rls.mjs` を再実行し children RLS / employees ポリシーが想定どおりであることを再確認
- [ ] 適用後 snapshot 不要（storage policy は触らないため §16-3 対象外）。`docs/migration-applied.md` に 214 を記録

### 将来対応（今回スコープ外）
- manager / admin の職員編集も RPC に統一（今回は影響最小のため shift_manager 経路のみ）

---

## 別視点確認

① 児童は RLS 許可済みのためフロント解除のみで通ること（probe 確認済）② 職員は employees の RLS 未許可のため RPC 必須で、直接 update 解禁では権限昇格リスクがあること ③ RPC が9カラム＋並び順以外を触らないこと（role 昇格不能）④ manager/admin のコードパスと RLS を一切変えないこと ⑤ shift_manager のスコープが自 facility に限定されること（`get_my_managed_facility_ids`）⑥ 社員モード（/admin/employees）は従来どおり遮断されたままであること ⑦ 214 が 200番台のため migration-applied.md 記録が必要なこと
