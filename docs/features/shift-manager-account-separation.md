# shift-manager-account-separation

> ステータス: 承認済（2026-05-20）。両 repo（staffbase / deaf-ic）に適用。

## 1. 機能概要

- 機能名: `shift-manager-account-separation`
- 目的: 社員管理一覧（`/admin/employees`）で、シフト統括専用アカウント（`role='shift_manager'`）が通常社員と同じ表に混在し「社員数」にも数えられている。これを (1) 社員数カウントから除外し、(2) 通常社員とは別のセクションに分けて表示する。
- 背景: `shift_manager` はシフト・送迎専用のアカウント（migration 140）。すでに進捗管理系（`get_my_subordinate_progress` RPC = migration 171 / `/api/reports` / admin・mgr ダッシュボード）からは除外済みで「社員管理の対象外」という運用が確立している。社員管理一覧ページだけがこの除外に追従できていない。

### スコープ

**やる:**
- `app/(admin)/admin/employees/page.tsx`: 「社員数」カウント（`{filtered}/{total}名`）の分子・分母から `shift_manager` を除外
- 同ページ: `shift_manager` アカウントを通常社員テーブルとは別セクション「シフト統括アカウント」に分離表示
- 両 repo（staffbase / deaf-ic）に同一適用

**やらない:**
- `components/admin/EmployeeTable.tsx` の変更 — 別セクションはページ側で `EmployeeTable` を 2 回描画して実現（コンポーネント自体は無変更）
- mgr ダッシュボード / admin ダッシュボード / 閲覧レポートの「社員数」— **すでに `shift_manager` 除外済み**（後述 §2）。無変更
- `shift_manager` を一括書類発行（`BulkIssueCompanyDocumentsButton`）の対象から外すか — 別問題。今回スコープ外
- DB スキーマ変更・migration — 不要（`employees.role` の既存 enum 値で判定）
- ロール絞り込みドロップダウンへの「シフト統括」追加 — 別セクション化により不要

---

## 2. 影響範囲

### データ層
- DB 変更なし。`employees.role = 'shift_manager'` の既存値で判定するのみ。

### サーバー層
- 変更なし。`/admin/employees` はクライアントで `supabase.from('employees').select('*')` を直接実行（role フィルタ無し＝ shift_manager も取得済み）。取得はそのまま、表示・集計をクライアントで分離する。

### クライアント層
- `app/(admin)/admin/employees/page.tsx`:
  - `filtered` useMemo の先頭で `role === 'shift_manager'` を除外
  - 「社員数」表示（L88 `${filtered.length} / ${employees.length}名`）の分母を「shift_manager を除いた総数」に
  - `shift_manager` 用の派生リスト（検索 + 在籍状況フィルタのみ適用）を新規 useMemo で算出
  - 通常社員テーブルの下に「シフト統括アカウント」セクションを条件付きで描画

### 「社員数」を表示する他箇所の確認結果（すべて除外済み・無変更）
| 箇所 | 状態 |
|---|---|
| `app/(manager)/mgr/dashboard/page.tsx` 「社員数」 | `active` は `get_my_subordinate_progress` RPC 由来。RPC が migration 171 で `shift_manager` 除外済み ✓ |
| `app/(admin)/admin/dashboard/page.tsx` | employees 取得が `.neq('role', 'shift_manager')` 済み（L48、コメントに「171 以降 shift_manager は進捗一覧から除外」）✓ |
| `components/admin/ReportMatrix.tsx` 「社員数」カード | `/api/reports` が `.neq('role','shift_manager')` 済み ✓ |
| `app/(admin)/admin/documents/page.tsx` | 「社員数」見出しの数値表示は無し（employees はプレビュー用にロードのみ）。スコープ外 |

### 横断
- `docs/reference-map.md` に本機能の参照エントリを追記。

---

## 3. 表出箇所マップ

| 箇所 | 内容 |
|---|---|
| サイドバー / ナビ | 該当なし |
| ダッシュボードのカード | 該当なし（ダッシュボードの「社員数」は既に shift_manager 除外済み・無変更） |
| 設定画面の項目 | 該当なし |
| 通知・トースト・モーダル | 該当なし |
| ヘッダー・フッター・パンくず | ✅ `/admin/employees` ページ見出し下の「{X} / {Y}名」カウントが shift_manager を除いた数になる |
| 一覧本体 | ✅ 通常社員テーブル（既存）＋ 新規「シフト統括アカウント」セクション（shift_manager が 1 件以上のときのみ表示） |
| ロール別の表示差異 | `/admin/employees` は admin 専用ページ（manager / shift_manager は middleware で到達不可）。本変更で新たなロール差分は発生しない |
| モバイル時の表示 | 既存 `EmployeeTable` の `overflow-x-auto` 横スクロールを踏襲。セクション見出しは通常の見出しスタイル |

---

## 4. 連動更新ポイント

| トリガー | 連動して触るファイル/関数 |
|---|---|
| `filtered` から shift_manager を除外 | `app/(admin)/admin/employees/page.tsx` の `filtered` useMemo |
| 「社員数」カウントの分母変更 | 同ページ L88 付近。`employees.length` → `shift_manager` を除いた件数 |
| shift_manager セクション用リスト | 同ページに `shiftManagerList` useMemo を新規追加（`search` + `statusFilter` のみ適用） |
| shift_manager セクションの描画 | 同ページの `<EmployeeTable>` 描画箇所の下に、見出し + 2 つ目の `<EmployeeTable>` を条件付き追加 |
| `EmployeeTable` 再利用 | `components/admin/EmployeeTable.tsx` は**無変更**（`employees: Employee[]` を受け取る汎用テーブルとして 2 回利用）|
| 両 repo 同期 | staffbase（worktree `relaxed-morse-e8230e`）と deaf-ic 双方に同一変更。色クラスのみ `diletto-` ⇔ `brand-` 差 |
| ドキュメント | `docs/reference-map.md` に追記 |

ファイル一覧:
- `app/(admin)/admin/employees/page.tsx`
- `docs/reference-map.md`

---

## 5. ロール別権限マトリクス

| 操作 | admin | manager | shift_manager | employee |
|---|---|---|---|---|
| `/admin/employees` を開く | ✅ | ❌ middleware で遮断 | ❌ | ❌ |
| 通常社員テーブルを見る | ✅ | — | — | — |
| 「シフト統括アカウント」セクションを見る | ✅ | — | — | — |

本変更は admin 専用ページ内の表示整理のみ。権限境界（middleware / RLS）には一切触れない。

---

## 6. 既存機能との差分・依存

- **既存**: `/admin/employees` は全 `employees` を 1 テーブルに描画。`shift_manager` も通常社員と同列に並び、「社員数」にも算入されていた。
- **差分**: `shift_manager` を別セクションに分離 + 社員数から除外。進捗管理系（171 / `/api/reports` / ダッシュボード）が既に確立した「shift_manager は社員管理対象外」という扱いに、社員管理一覧の表示も揃える。
- **依存**: `employees.role` の値 `'shift_manager'`（migration 140）。`EmployeeTable` コンポーネント（再利用）。
- **この変更で影響を受ける既存機能**: なし（表示・集計の分離のみ。フィルタ・検索・招待再送・個別連絡などの既存機能はそのまま動く）。

---

## 7. 実装ルール

- `components/ui/*` は変更しない。`EmployeeTable` を再利用（2 回描画）し、コンポーネント本体は無変更
- shift_manager セクションは `shiftManagerList.length > 0` のときだけ描画（0 件なら見出しごと非表示）
- セクション見出しは既存の見出しスタイルに合わせる（`text-lg font-bold` 程度）+ 補足文「シフト・送迎専用のアカウントです。社員数には含まれません。」を `text-sm text-brand-gray`（staffbase は `diletto-gray`）で添える
- shift_manager セクションに適用するフィルタ: **検索ボックス + 在籍状況** のみ。施設フィルタ・ロールフィルタは適用しない（ロールフィルタは通常社員テーブル専用）
- 「社員数」カウントの文言・フォーマット（`{X} / {Y}名`）は維持。値だけ shift_manager 除外後のものにする
- 命名: `shiftManagerList`（camelCase）

---

## 8. 完成条件

### 正常系（localhost で確認 — staffbase:4003 / deaf-ic:6001）
- [ ] `/admin/employees` の「社員数」が shift_manager を除いた数になる（例: shift_manager 1 件なら従来比 -1）
- [ ] 通常社員テーブルに shift_manager 行が出ない
- [ ] テーブル下に「シフト統括アカウント」セクションが表示され、shift_manager 行（SHIFT-3BAE 等）がそこに出る
- [ ] 検索ボックスにシフト統括アカウントの名前/番号/メールを入れると、シフト統括セクションでヒットする
- [ ] ロールフィルタ（管理者/マネージャー/一般社員）を変えても シフト統括セクションは影響を受けない

### 異常系・境界値
- [ ] shift_manager アカウントが 0 件のテナント → 「シフト統括アカウント」セクションが丸ごと非表示
- [ ] 検索で shift_manager が 0 ヒット → シフト統括セクション非表示（検索の挙動と一貫）
- [ ] 在籍状況フィルタ「退職」→ 退職した shift_manager のみセクションに表示

### 確認
- [ ] `npm run build` 両 repo パス
- [ ] 両 repo で色クラス以外の差分が無い

### 将来対応（今回スコープ外）
- 一括書類発行（`BulkIssueCompanyDocumentsButton`）が shift_manager を対象に含むかの精査

---

## 別視点確認

① 社員数カウントの分子（filtered）・分母（total）の両方から shift_manager が除外されている ② ダッシュボード等の既存「社員数」は無変更で、すでに除外済みの状態が保たれている ③ `EmployeeTable` コンポーネントは無変更で、通常社員・shift_manager の両方を正しく描画する ④ shift_manager セクションがロールフィルタの影響を受けない（独立セクション）⑤ shift_manager 0 件のテナントで空セクションが出ない ⑥ admin 専用ページであり middleware / RLS の権限境界に触れていない ⑦ 両 repo（staffbase / deaf-ic）で色クラス以外の差分が無い
