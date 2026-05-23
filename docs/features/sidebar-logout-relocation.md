# sidebar-logout-relocation

> 2026-05-23 起票・承認済 / モードB(新規) / feature-impact-spec

## 1. 機能概要

- **機能名**: sidebar-logout-relocation
- **目的**: ヘッダー右上の「ログアウト」ボタンを撤去してヘッダーを整理し、サイドバー最下部に常設する。デスクトップ・モバイル（Sheet 内）どちらでもサイドバー底に固定表示。
- **スコープ(やる)**:
  - `app/(admin)/layout.tsx` のヘッダー（mobile + desktop）からログアウトボタンを削除
  - `app/(manager)/layout.tsx` のヘッダー（mobile + desktop）からログアウトボタンを削除
  - 上記 2 つの `SidebarContent` 末尾（スクロール領域の下、border-top 区切り）にログアウトボタン + ログイン名を表示するブロックを追加
  - `app/(employee)/layout.tsx` は**サイドバーを持たない**（ヘッダー + タブナビ構成）→ ログアウトは**ヘッダー右上に残す**（仕様書 §3 で明記）
- **スコープ(やらない)**:
  - サイドバー全体のリデザイン
  - employee 画面のサイドバー化（既存タブ UI を維持）
  - ログアウト確認モーダル追加

---

## 2. 影響範囲(impact-catalog 該当項目のみ)

- DB 変更 = なし
- API 変更 = なし
- 型変更 = なし
- マイグレーション = なし
- 環境変数 = なし
- platform-constraints = なし
- 影響は **2 ファイル**（`app/(admin)/layout.tsx`, `app/(manager)/layout.tsx`）+ アクセシビリティ確認のみ

---

## 3. 表出箇所マップ(空欄禁止)

| 表出箇所 | 内容 |
|---|---|
| サイドバー/ナビ | **(変更)** デスクトップ・モバイル両 sidebar の最下部に「ログアウト」ボタン + 自分の氏名（小さく上に表示）を border-top で区切って常設 |
| ダッシュボードのカード | 該当なし |
| 設定画面 | 該当なし |
| 通知/トースト/モーダル | 該当なし（既存の `signOut` フローのまま、確認ダイアログなし） |
| ヘッダー/フッター/パンくず | **(変更)** admin / manager の mobile header + desktop header からログアウトボタンを削除。会社名・氏名挨拶 / 事業所セレクタ / 通知ベル / 「社員画面」リンクは残す |
| ロール別表示差 | admin layout / manager layout は同パターンで適用。**employee layout (`/my/*`) はサイドバーが無いためヘッダー右上のログアウトを維持**（変更なし） |
| モバイル時 | Sheet 内 SidebarContent 最下部に同様に表示。Sheet を開いた状態で最下部までスクロールするとログアウトが見える（Sheet の高さ 100dvh で `flex flex-col` の最後の child） |

---

## 4. 連動更新ポイント(空欄禁止)

| トリガー | 連動して触るファイル / 関数 |
|---|---|
| [変更] ログアウトボタンの位置 | `app/(admin)/layout.tsx` の `SidebarContent` に `<SidebarFooter />` 追加 + ヘッダー（mobile / desktop）の `<Button onClick={handleLogout}>ログアウト</Button>` 削除 |
| [変更] ログアウトボタンの位置 | `app/(manager)/layout.tsx` の同パターン適用 |
| [新規] サイドバーフッターコンポーネント | `SidebarContent` 内に inline で `<div className="border-t ... px-4 py-3 shrink-0"><p>{userName}</p><Button onClick={handleLogout}>ログアウト</Button></div>` を追加（共通化はしない。2 ファイル各々に書く。理由: 既存 `SidebarContent` が layout 内ローカル関数で、handleLogout / userName のスコープが layout に閉じているため、ファイル間切り出しの ROI が低い） |
| [変更] ヘッダー右側のレイアウト | ボタン削除で `gap-2 / gap-3` の隙間が空くだけなので追加調整不要。挨拶 + 事業所セレクタ + 通知ベル + 社員画面リンクが残る |
| [employee] | 変更なし（タブ UI 維持。ヘッダー右上のログアウトは残置） |
| [docs] reference-map | layout 構造の変更なので **追記不要**（マイグレーションも型もなし）。ただし `docs/error-log.md` の対象ではない（バグではないため） |
| [docs] features | 本ファイル `docs/features/sidebar-logout-relocation.md` のドラフト→承認版に格上げ |

---

## 5. ロール別権限マトリクス

| ロール | サイドバー底ログアウト表示 | ヘッダー右ログアウト表示 |
|---|---|---|
| admin (admin layout) | ○ | × (削除) |
| manager (manager layout) | ○ | × (削除) |
| shift_manager (admin layout 流用) | ○ | × (削除) |
| employee (employee layout, サイドバーなし) | — | ○ (維持) |

- 全ロールでログアウト導線は 1 つ以上維持されることを保証

---

## 6. 既存機能との差分・依存

### 似た機能の有無
- 「ログアウト」ボタンは現状 admin / manager / employee の 3 layout すべてに `handleLogout` 関数で実装済。**ロジックは変更しない。位置だけ移す**。

### 依存先
- `createClient` / `supabase.auth.signOut()` / `router.push('/login')` の既存フロー

### この変更で影響を受ける既存機能
- なし（純粋な UI レイアウト変更）
- ただし「ヘッダーがスッキリする」副作用として右側に余白が増える。挨拶テキスト・事業所セレクタ・通知ベル・社員画面リンクの 4 つは現状通り `flex items-center gap-3` で並ぶため見た目崩れなし

---

## 7. 実装ルール

### 命名
- 変数: 既存の `handleLogout` を流用
- フッター部分の className: 既存 sidebar の `border-brand-gray/10` / `text-brand-gray` トークンに合わせる

### 再利用すべき既存コンポーネント
- `Button` (shadcn) variant=`ghost` + size=`sm` を継続

### design-system トークン
- `border-t border-brand-gray/10` で区切り線
- `text-xs text-brand-gray-light` で氏名小表示
- `text-sm text-brand-gray hover:text-brand-ink` でログアウト文字色

### モバイル対応方針
- Sheet（モバイル sidebar）は `height: 100dvh` で `flex flex-col` 構造。`SidebarContent` 内で `flex-1 overflow-y-auto` のスクロール領域の**外**にフッターを置くことで常時可視

### アクセシビリティ（CLAUDE.md §9）
- ログアウトボタンは `<Button>` で focus / Enter 操作可
- `aria-label="ログアウト"` 明示

---

## 8. 完成条件

### 正常系
- [ ] `npm run dev` 起動 → admin としてログイン → デスクトップ sidebar 最下部に氏名 + ログアウトボタンが見える
- [ ] ログアウトボタン押下 → `/login` に遷移、router.refresh() が走る
- [ ] モバイル幅 (≤768px) で ハンバーガー → Sheet 内 sidebar 最下部にも同じく見える
- [ ] manager としてログイン → 同じ挙動
- [ ] shift_manager としてログイン → admin layout を流用するため同じく見える
- [ ] employee として `/my/dashboard` → サイドバー無し、ヘッダー右上のログアウトが**そのまま残っている**

### 異常系
- [ ] ログアウトボタンを連打 → 既存ロジック上 1 回目で signOut → `/login` に飛ぶので 2 回目は無効。エラー出ない
- [ ] ネットワーク切断中にログアウト → `signOut` が失敗してもクライアント側で `router.push('/login')` が走るため UX 上は遷移する（既存挙動踏襲）

### 境界値
- [ ] 氏名が長い社員（例: `山田太郎太郎太郎`）→ `truncate` で省略表示
- [ ] サイドバーが項目過多でスクロール状態 → 最下部までスクロールしないと見えないが、`flex` 構造上スクロール領域**外**のため**常時可視**

### ローカル確認項目
- [ ] `npm run dev` → admin / manager / employee の 3 ロールでログイン確認
- [ ] PC + タブレット幅でレイアウト確認
- [ ] Sheet が iOS Safari でも 100dvh で底まで届くか確認
- [ ] `npm run build` がエラーなく通る

### 将来対応の分離
- ログアウト確認モーダル → 別フェーズ
- employee 画面のサイドバー化 → 別フェーズ

---

## 9. 実装メモ（実装後に追記）

(未実装)
