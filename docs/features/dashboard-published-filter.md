# dashboard-published-filter

## 1. 機能概要

- 機能名: `dashboard-published-filter`
- 目的: `/admin/dashboard` と `/mgr/dashboard` の「達成率」「概要」「社員進捗一覧」の母数を **公開済み (`is_published=true`) コンテンツのみ** に揃え、未公開 (ドラフト) が達成率を不当に下げる現状の不整合を解消する。概要カードは「**公開件数 / 全件**」表示にする。
- スコープ:
  - **やる**
    - 達成率カード5種の**分母**を `is_published=true` の件数に変更
    - 概要カード5種の**表示**を「{公開件数} / {全件} 件」フォーマットに変更
    - 社員進捗テーブルの ProgressBadge `{current}/{total}` の `total` も公開件数に変更
    - リマインドモーダル内 `{current}/{total}` の `total` も公開件数に変更
    - admin / manager 両ダッシュボードで同じロジック（shift_manager は admin layout 流用だが shift モード固定 (migration 140) のため実質非該当）
  - **やらない**
    - DB スキーマ変更（`is_published` 列は既存 4 テーブルに既に存在）
    - `employee_progress` ビュー / `get_my_subordinate_progress` RPC (migration 156) の変更
    - 達成率の **分子** （社員の完了件数）の取得方式変更：そのまま使い、`Math.min(num/denom, 1)` でクリップ済み
    - employee 用ダッシュボード（`/my/dashboard`）の変更
    - 書類 (`document_templates`) は `is_published` 列を持たない（migration 122 の配布対象ルールで個別判定）。**書類の達成率分母はクライアント側で従来通り社員別 audience 数を使う**

### 書類の取り扱い（決定済）

`document_templates` に `is_published` がないため、概要カード「書類」は **`{N} 件`（現状維持、単一件数）** で表示する。書類だけ別フォーマット。書類の達成率分母は従来通り社員別 audience 数（`docTotalsByEmployee`）を使う。

---

## 2. 影響範囲（関連項目のみ）

### データ層
1. **DB スキーマ**: スキーマ変更なし。既存 `is_published` (boolean) を SELECT 時の WHERE 句で使う
   - `announcements.is_published` ✓
   - `compliance_documents.is_published` ✓
   - `trainings.is_published` ✓
   - `manuals.is_published` ✓
   - `document_templates`: `is_published` 無し → 全件扱い

### サーバー層
5. **API / Server関数**: 既存の `supabase.from(...).select(...)` クエリに `.eq('is_published', true)` を加える。新規 RPC や migration は不要

### クライアント層
10. **UI / コンポーネント**:
    - `app/(manager)/mgr/dashboard/page.tsx` — totals state を `publishedTotals` / `allTotals` の 2 系統に分割、Promise.all クエリで両方取得、StatCard 表示変更
    - `app/(admin)/admin/dashboard/page.tsx` — Promise.all クエリで `is_published=true` 件数も取得し、ProgressDashboard に渡す props を 2 系統化
    - `components/admin/ProgressDashboard.tsx` — Props 型に `publishedTotals` / `allTotals` 追加、StatCard 表示・calcRate 分母・ProgressBadge total・ReminderModal totals に反映

### 横断
22. **ドキュメント**: `docs/reference-map.md` を更新（is_published を新たに参照するファイル群を追記）

---

## 3. 表出箇所マップ

| 箇所 | 内容 |
|---|---|
| サイドバー / ナビゲーション | 該当なし |
| ダッシュボード / トップ画面のカード・ウィジェット | ✅ **達成率5カード** / **概要5カード** / **社員進捗テーブル6列バッジ** |
| 設定画面の項目 | 該当なし |
| 通知・トースト・モーダル | ✅ リマインドモーダル `{current}/{total}` バッジ（admin/manager 両方） |
| ヘッダー・フッター・パンくず | 該当なし |
| ロール別の表示差異 | admin → `ProgressDashboard.tsx` 経由 / manager（と shift_manager） → `mgr/dashboard/page.tsx` 直書き |
| モバイル時の表示 | 既存レイアウト維持。表示値のみ変更 |

---

## 4. 連動更新ポイント

| トリガー | 連動して触るファイル/関数 |
|---|---|
| `mgr/dashboard` の Promise.all クエリで `is_published=true` 版を追加 | `app/(manager)/mgr/dashboard/page.tsx` の `useEffect.load` 内クエリ + `totals` state を `publishedTotals` / `allTotals` に分割 |
| `mgr/dashboard` の達成率分母 | `calcRate(key, total)` の第2引数を `publishedTotals.*` に変更 |
| `mgr/dashboard` の概要カード | `<StatCard label="..." value={publishedTotals.x} sub="件" />` → `<StatCard value={publishedTotals.x} total={allTotals.x} sub="件" />` |
| `mgr/dashboard` のテーブルバッジ | `<ProgressBadge current={...} total={publishedTotals.x} />` |
| `mgr/dashboard` のリマインドモーダル `total` | `total={openKey === 'docs_submitted' ? publishedTotals.docs : ...}` |
| `admin/dashboard` の Promise.all クエリ | `app/(admin)/admin/dashboard/page.tsx` で `is_published=true` 版を追加 |
| `admin/dashboard` の setData 引数 | `totalCompliance` / `totalTrainings` / `totalAnnouncements` / `totalManuals` を公開件数に置換、全件も新規 props で渡す |
| `ProgressDashboard.tsx` Props 型 | `totalCompliance` 等を「公開件数」と「全件」の 2 系統化 |
| `ProgressDashboard.tsx` の calcRate / StatCard / ProgressBadge / ReminderModal | 上記 props に追従 |
| `docs/reference-map.md` | `is_published` を新規参照するファイル一覧を追記 |
| `StatCard` コンポーネント | 「公開件数 / 全件」表示のため `total?: number` を追加するか、`value` の表記を変える |

ファイル一覧:
- `app/(manager)/mgr/dashboard/page.tsx`
- `app/(admin)/admin/dashboard/page.tsx`
- `components/admin/ProgressDashboard.tsx`
- `docs/reference-map.md`

---

## 5. ロール別表示マトリクス

| 表示要素 | admin | manager / shift_manager | employee |
|---|---|---|---|
| 達成率5カード | テナント全社員 × 公開件数で計算 | 管轄施設の部下 × 公開件数で計算 | 該当なし |
| 概要5カード | 公開件数 / 全件 | 公開件数 / 全件 | 該当なし |
| 社員進捗一覧バッジ | 部下完了数 / 公開件数 | 部下完了数 / 公開件数 | 該当なし |
| リマインドモーダル | 部下完了数 / 公開件数 | 部下完了数 / 公開件数 | 該当なし |

shift_manager は admin layout を流用するが shift モード固定 (migration 140) なのでダッシュボード非到達。

---

## 6. 既存機能との差分・依存

- **既存**: 全件 (公開・未公開混在) を分母にしていた → 未公開コンテンツが達成率を不当に下げていた / 概要は単純な件数
- **依存テーブル**:
  - `announcements.is_published`（既存）
  - `compliance_documents.is_published`（既存）
  - `trainings.is_published`（既存）
  - `manuals.is_published`（既存）
- `document_templates` には `is_published` 概念がない（書類は audience rule の個別判定）

---

## 7. 実装ルール

- 既存の `StatCard` / `RateCard` / `ProgressBadge` を**再利用**。新規コンポーネントは作らない
- `StatCard` を「{published}/{total} 件」表示に拡張するため、`total?: number` の optional prop を追加（後方互換）
- 命名: state は `publishedTotals` / `allTotals`、props も同名で揃える
- 母数 0 件のときの表示: 既存ロジックを踏襲（`-` 表示、ReminderModal は「対象項目が登録されていません」）
- 書類は `is_published` 概念なし。書類カードは `<StatCard label="書類" value={N} sub="件" />`（total prop を渡さない）でレンダリング
- `Math.min(num/denom, 1)` のクリップロジックは維持（admin で draft への read が numerator に紛れ込むケース対策）

---

## 8. 完成条件

### 動作確認 (localhost:6001)
- [ ] 未公開 announcement / training / manual / compliance を 1 件ずつ追加 → 概要が `n/(n+1) 件` になる
- [ ] 未公開を 1 件追加 → 達成率が**変わらない**（分母から外れる）
- [ ] 未公開を「公開」に切り替えると概要・達成率が即反映（リロード後）
- [ ] admin / manager 両方で同じ挙動
- [ ] リマインドモーダルの `{current}/{total}` も公開件数に追従
- [ ] 社員進捗テーブルの badge も公開件数に追従
- [ ] **書類**: `{N} 件` 表示のまま（他カードと別フォーマット）
- [ ] tsc --noEmit エラー 0
- [ ] eslint で新規エラーなし

### 将来対応（今回スコープ外）
- `document_templates` に `is_published` を追加するか別途検討
- `employee_progress` ビュー / `get_my_subordinate_progress` RPC を published 限定にするか別途検討（分子側のクリーンアップ）
