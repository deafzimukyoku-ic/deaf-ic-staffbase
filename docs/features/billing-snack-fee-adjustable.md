# billing-snack-fee-adjustable（利用料金表「おやつ等」の金額を手動調整可能にする）

> **承認済み・実装完了** — 2026-07-17 ユーザー承認（「進めてOK」）。
> §5 の shift_manager の扱いは、実 DB の probe により **既に manager と同一ポリシーで利用可能**と判明したため
> 追加対応なしで決着（当初「保存できない」と記載していたのは誤りで、撤回済み。経緯は §5 参照）。

## 1. 機能概要

### 機能名
`billing-snack-fee-adjustable`

### 目的
利用料金表の「おやつ等」列は現在 `出席日数 × SNACK_FEE_PER_DAY(50)` の自動算出のみで、
画面から一切いじれない。実運用では「この子は当月おやつを 2 日分食べていない」等の
微調整が発生するため、**自動算出値を起点に ▲▼ で 50 円ずつ加減できる**ようにする。

### スコープ（やる）
- 「おやつ等」セルに ▲（+50）/ ▼（−50）ボタンを追加し、児童 × 月ごとに金額を調整できる
- 調整値は `billing_summaries` に保存し、**以降その月は固定**（出席日数が後から変わっても追従しない）
- 「↺ 自動に戻す」で調整を捨て、自動算出（出席日数 × 50）に復帰できる
- 調整の有無は画面上で視覚的に区別できる（色 + アイコン + テキスト。§7 アクセシビリティ）
- 調整値は 印刷（A4 横）/ Excel 出力 / 合計行 のすべてに反映される

### スコープ（やらない）
| やらないこと | 理由 |
|---|---|
| `SNACK_FEE_PER_DAY=50` の値の変更・可変化 | ユーザー確定：単価をグローバルに変えるのではなく「▲▼ で 50 円ずつ加減」方式。定数は**ステップ幅（＝1 日分）**として流用するため `lib/constants.ts` は無変更（＝ CLAUDE.md §7「変更禁止（承認必須）」に触れない） |
| 事業所設定への「おやつ単価」追加 | 同上。`facility_shift_settings` は無変更 |
| 教材印刷代を料金表上で編集 | ユーザー確定：「おやつ等のみでよい」。`children.kumon_monthly_fee`（児童設定画面）のまま |
| イベント参加費を料金表上で編集 | 同上。`events.price` のまま |
| 列名「おやつ等」の可変化 | 同上 |
| 出席日数のライブ集計をやめる | 現行の意図的挙動（[BillingFull.tsx:225-227](../../components/shift/BillingFull.tsx#L225)「利用表を直せば料金表も追従する」）を維持。**おやつ等だけ**が override で固定される |

---

## 2. 影響範囲

`docs/constraints.md` を確認済み。**§1（Vercel Function 経由の大容量配信）/ §2（Supabase は pooler 経由）
のいずれにも抵触しない**。本件は既存テーブルへの 1 列追加 + クライアント内計算のみで、
新規 API ルートも大容量転送も発生しない。apply スクリプトは §2 に従い pooler 経由で書く。

| 種別 | 対象 | 変更内容 |
|---|---|---|
| DB | `public.billing_summaries` | 列追加 `snack_fee_override integer null`（CHECK: null または >= 0） |
| Migration | `supabase/migrations/221_billing_snack_fee_override.sql` | 新規（最新は 220 = 次番 221） |
| Migration 適用 | `scripts/apply-migration-221.mjs` | 新規（pooler 経由 / rollback 付き実証） |
| 純関数 | `lib/logic/computeBilling.ts` | `computeBillingRow` に第 5 引数 `snackOverride?: number \| null` を追加（既存 `copayOverride` と同じパターン）。`BillingChildResult` は変更なし |
| UI | `components/shift/BillingFull.tsx` | `RowState.snackOverride` 追加 / `BillingSummaryRow` に `snack_fee_override` 追加 / fetch の select 拡張 / `computed` の snackFee 算出変更 / 「おやつ等」セルに ▲▼/↺ 追加 / `handleSave` の upsert 列追加 / Excel・印刷・合計行の追従 |
| ドキュメント | `CLAUDE.md` §8 | `SNACK_FEE_PER_DAY=50` の説明に「料金表セルで ±50 手動調整可（`billing_summaries.snack_fee_override`）」を追記 |
| ドキュメント | `docs/reference-map.md` | `billing_summaries` の列一覧 + `computeBilling.ts` 署名 + migration 221 行を更新 |
| ドキュメント | `docs/migration-applied.md` | 221 の行を追加（CLAUDE.md §16-2） |
| ドキュメント | `docs/progress.html` | 本機能の行を追加（CLAUDE.md §3） |

### 変更しないファイル（誤爆防止のため明記）
- `lib/constants.ts` — `SNACK_FEE_PER_DAY` は値・名前とも据え置き（ステップ幅として参照するのみ）
- `lib/types.ts` — Billing 系の型は定義されておらず（`BillingSummaryRow` は `BillingFull.tsx` のローカル型）、変更不要
- `supabase/migrations/126,128,131` — 適用済みのため触らない（CLAUDE.md §7）
- `components/shift/ChildrenSettingsFull.tsx` / `EventSettingsFull.tsx` — 今回スコープ外
- `components/ui/*` — 変更禁止

---

## 3. 表出箇所マップ（空欄禁止）

| 表出箇所 | 内容 |
|---|---|
| サイドバー / ナビ | **該当なし**（既存ページ内の変更。`app/(admin)/layout.tsx:47` / `app/(manager)/layout.tsx:41` の「💰 利用料金表」リンクは無変更） |
| ダッシュボードのカード | **該当なし**（`app/(admin)/admin/shifts/dashboard/page.tsx:24` / `app/(manager)/mgr/shifts/dashboard/page.tsx:24` のカードは無変更） |
| 設定画面 | **該当なし**（事業所設定に単価を持たせない方式のため） |
| 通知 / トースト / モーダル | **該当なし**（保存失敗時の既存 `error` バナー（`BillingFull.tsx:665-669`）を流用。新規モーダルなし） |
| ヘッダー / フッター / パンくず | **該当なし**（`components/admin/Breadcrumb.tsx:28,49` の「利用料金表」は無変更） |
| **メイン表出①：料金表の「おやつ等」列（画面）** | `BillingFull.tsx` テーブル 6 列目。`▼` `金額` `▲` の横並び + 調整時のみ `↺`。調整済みは色 + `✎` アイコン + `title` テキストで明示 |
| **メイン表出②：合計行「おやつ等」** | `totals.snack` が override 反映後の実効値の総和になる |
| **メイン表出③：請求額列 + 合計** | `total = copay + snack(実効値) + kumon + eventTotal` に反映 |
| **メイン表出④：印刷（A4 横）** | ▲▼/↺ は `print-hide`、金額のみ `print:inline` で出力（既存の利用負担額セル `BillingFull.tsx:774-780` と同じ作法） |
| **メイン表出⑤：Excel 出力** | 「おやつ等」列（6 列目）と合計行に override 反映後の値。`computedById` 経由のため追加改修は不要 |
| **メイン表出⑥：脚注** | ページ下部の注記（`BillingFull.tsx:838-845`）に「おやつ等は ▲▼ で 50 円（1 日分）ずつ調整可。調整するとその月は固定され、出席日数を後から直しても追従しない」を追記 |
| ロール別表示差 | admin / manager / shift_manager すべて同一 UI（shift_manager も §5 のとおり読み書き可。UI の出し分けなし） |
| モバイル時 | 料金表は既に横スクロール前提（`overflow-auto` + `minWidth: 600 + events*80`）。▲▼ はタップ標的 24px 以上を確保し、セル幅 70px → **90px** に拡張（`BillingFull.tsx:707` の `width` と Excel 列幅 `ws.getColumn(6).width` は独立管理のため Excel 側は変更不要） |

---

## 4. 連動更新ポイント（空欄禁止）

`[トリガー] → [連動して触るファイル / 関数]` 形式。

| # | トリガー | 連動して触るもの |
|---|---|---|
| 1 | `billing_summaries` に `snack_fee_override` 列追加 | → `supabase/migrations/221_billing_snack_fee_override.sql`（新規作成）<br>→ `scripts/apply-migration-221.mjs`（新規作成・pooler 経由）<br>→ `docs/migration-applied.md`（221 行追加）<br>→ `docs/reference-map.md`（`billing_summaries` 列一覧 + migration 一覧） |
| 2 | 同上（RLS 影響の有無） | → **storage / RLS ポリシーは変更しない**（列追加のみ。既存 `bs_admin_all` / `bs_manager_facility` が `for all` のため新列も自動的に同ポリシー配下）。<br>→ CLAUDE.md §16-3 の snapshot 義務は **storage policy 変更時**の規定であり、本件は非該当 → `scripts/snapshot-storage-policies.mjs` は実行不要 |
| 3 | `computeBillingRow` の署名変更（引数追加） | → 呼び出し元を全走査。**現時点の実呼び出しは 0 件**（`BillingFull.tsx` は `computeDefaultCopayAmount` のみ import し、行の合算は `computed` useMemo で独自実装）。<br>→ そのため署名変更の破壊リスクは無いが、`docs/reference-map.md:1040` の `computeBilling.ts` 署名記述を更新 |
| 4 | `computed` useMemo の snackFee 算出変更（`BillingFull.tsx:274`） | → 同ファイル内の依存先すべて: `totals`（`:306` snack 合算 / `:312` grand）→ 表示セル（`:783`）→ 合計行（`:823`）→ Excel データ行（`:387`）→ Excel 合計行（`:408`）→ `handleSave` の `snack_fee`（`:464`）/ `total_amount`（`:467`） |
| 5 | `RowState` に `snackOverride` 追加 | → `fetchAll` の row 構築（`:220-236`）で `existing?.snack_fee_override ?? null` を格納<br>→ `BillingSummaryRow` interface（`:62-72`）に `snack_fee_override: number \| null`<br>→ fetch の `.select(...)`（`:146`）に `snack_fee_override` を追加（**追加漏れ＝常に undefined になり調整が消える最有力バグ点**）<br>→ `handleSave` の upsert 行（`:454-474`）に `snack_fee_override: r.snackOverride` |
| 6 | ▲▼/↺ 操作 | → `updateRow`（`:317`）経由で `dirty: true` → 「保存（N件未保存）」ボタンの `dirtyCount`（`:527`）に反映 |
| 7 | 「おやつ等」列の幅を 70px → 90px | → `BillingFull.tsx:707`（th の width）<br>→ table `minWidth`（`:693` の `600 + events.length * 80`）を `620 + events.length * 80` に調整<br>→ sticky 列の left 実測（`:254-268`）は先頭 3 列のみ対象のため **影響なし**（[[feedback_sticky_layer_pitfalls]] の轍を踏まない） |
| 8 | CLAUDE.md §8 の定数説明の変更 | → `CLAUDE.md:228` の `SNACK_FEE_PER_DAY=50`（…固定）の記述を更新（「固定」の語が実態と食い違うため） |
| 9 | 実装完了 | → `docs/progress.html` を完了に更新（CLAUDE.md §3・更新忘れ＝作業未完了）<br>→ エラーに遭遇した場合のみ `docs/error-log.md` に記録（CLAUDE.md §15） |

> 補足：本リポジトリに `docs/refmap/registry.tsv` / `build.sh` は**存在しない**（参照台帳は手動運用の
> `docs/reference-map.md`）。したがって `build.sh --check` は実行できない。台帳更新は #1・#3 で手動実施する。

---

## 5. ロール別権限マトリクス

対象操作：利用料金表ページの「おやつ等」▲▼ 調整と保存。

| ロール | 料金表ページ到達 | おやつ等の ▲▼ 調整 | 保存（`billing_summaries` 書込） | 根拠 |
|---|---|---|---|---|
| **admin** | 可（全事業所） | 可 | 可 | `bs_admin_all`: `get_my_role()='admin' and tenant_id = get_my_tenant_id()` |
| **manager** | 可（管轄事業所のみ） | 可 | 可（管轄事業所のみ） | `bs_manager_facility`: `get_my_role() = ANY(ARRAY['manager','shift_manager']) and tenant_id = get_my_tenant_id() and facility_id in (select get_my_managed_facility_ids())` |
| **shift_manager** | 可（主所属 1 事業所のみ） | 可 | 可（主所属 1 事業所のみ） | manager と**同一ポリシー**（上記 `bs_manager_facility` に含まれる）。`middleware.ts:119-124` が `/admin/shifts/*` を許可し、料金表 `/admin/shifts/output/billing` はその配下。migration 140 の用途定義にも「利用料金表」が明記されている |
| **employee** | 不可 | 不可 | 不可 | ページが `(admin)` / `(manager)` ルートグループ配下。`billing_summaries` に employee ポリシー無し |

新列 `snack_fee_override` は既存ポリシーが `for all`（＝全列対象）のため、上記マトリクスがそのまま適用される。
**RLS の追加は不要**。

### ✅ 決着済み（旧「要確認①」）— shift_manager は追加対応不要

当初、本仕様書は「shift_manager は料金表に到達できるが `billing_summaries` を読めず保存もできない」
と記載していた。**これは誤りだったので撤回する。**

- **誤りの原因**：`128_billing.sql` と `131_multi_facility_rls.sql` のファイルだけを読み、
  「`bs_manager_facility` の述語は `get_my_role()='manager'` だから shift_manager は弾かれる」と推論した。
  しかし **`140_shift_manager_role.sql` が同名のポリシーを drop & recreate して
  `get_my_role() = ANY(ARRAY['manager','shift_manager'])` に差し替えていた**。
  ポリシー「名」は 128/131/140 で不変のため、名前の一覧だけでは世代を判別できない。
- **事実確認（2026-07-17, `scripts/probe-billing-rls.mjs`）**：実 DB の `pg_policy.polqual` 本体と、
  実在の shift_manager アカウント（🎨パレットシフト統括）の JWT を偽装した実挙動テストで決着。

  | 検証 | 結果 |
  |---|---|
  | `bs_manager_facility` の USING 本体 | `get_my_role() = ANY (ARRAY['manager','shift_manager'])` を**含む** |
  | `bep_manager_facility` の USING 本体 | 同上（イベント参加も可） |
  | `get_my_managed_facility_ids()` | shift_manager の主所属 facility を返す（`employees.facility_id` ∪ `manager_facilities`） |
  | 当該アカウントからの SELECT | 実在 52 行に対し **52 行見える**（RLS で削られない） |
  | 当該アカウントからの UPDATE（`snack_fee_override`） | **52 行更新成功**＝本機能の保存も可 |

- **教訓（CLAUDE.md §16-2 の実例）**：RLS の世代判定は必ず `pg_policy.polqual` / `pg_policies.qual` の
  **本体**で行う。ポリシー名・migration ファイルの読解・「後続 migration が触っていないはず」という
  推測はいずれも根拠にならない。同名 drop&recreate が定石として使われているため。

---

## 6. 既存機能との差分・依存

### 似た機能の有無（統合 / 分離の判断）
**あり。「利用負担額」列が既に同型の手動オーバーライドを実装している**（`RowState.copayAmount` +
`computeDefaultCopayAmount` で初期値算出 + セル編集 + `billing_summaries.copay_amount` に保存）。

→ **判断：統合はせず、同じ設計パターンを踏襲して分離実装する。**
理由は 3 点で、いずれも既存挙動を壊さないため：
1. 利用負担額は「テキスト入力で任意額」だが、おやつ等は「▲▼ で 50 円刻み」＝ UI 作法が異なる（ユーザー確定事項）
2. 利用負担額は `copay_amount` を **null 許容の実値**として保存（null = 「—」表示）。
   おやつ等は **override 列を別途持ち**、null = 「自動算出」を意味する。**null の意味論が逆**のため列を共有できない
3. 既存の `copay_amount` の意味を変えると過去データの解釈が壊れる

### 依存先
- `lib/logic/attendance.ts` の `isAttended()` — 出席日数の集計元（**変更しない**。CLAUDE.md §10 の一元化ルールを維持）
- `lib/constants.ts` の `SNACK_FEE_PER_DAY` — 自動算出とステップ幅の両方に使用（**値は変えない**）
- `billing_summaries` の UNIQUE `(tenant_id, facility_id, year, month, child_id)` — upsert の onConflict キー

### この変更で影響を受ける既存機能
| 既存機能 | 影響 |
|---|---|
| 料金表の請求額・合計 | override 反映後の値になる（＝意図した変更） |
| 料金表の Excel 出力 / A4 横印刷 | 同上。列構成・レイアウトは不変 |
| 出席日数のライブ追従 | **維持**。ただし「おやつ等を調整した児童」のみ、おやつ額が出席日数に追従しなくなる（＝ユーザー確定の「保存時の金額で固定」） |
| 過去の保存済み月 | `snack_fee_override` は既存行で `null` → 全児童が従来どおり自動算出。**数字は 1 円も変わらない**（後方互換） |
| `children.kumon_monthly_fee` / `events.price` | 無影響 |
| デイロボ連携 | 無影響（元々連携なし） |

---

## 7. 実装ルール

### 命名規則（CLAUDE.md §11 準拠）
- DB 列：`snack_fee_override`（snake_case）
- TS 変数：`snackOverride`（camelCase）
- migration：`221_billing_snack_fee_override.sql`（NNN_snake_case）
- apply script：`scripts/apply-migration-221.mjs`（kebab-case）

### 再利用すべき既存コード
- `Button` は使わない（セル内の小型ステッパーのため）。既存の料金表セルと同じく素の `<button>` +
  インライン style（`var(--rule)` / `var(--ink)` / `var(--accent)`）で統一
- 印刷の出し分けは既存作法を踏襲：操作 UI に `print-hide`、値に `hidden print:inline`
  （`BillingFull.tsx:774-780` と同型）
- 金額表示は既存 `fmtYen`（`BillingFull.tsx:79`）
- 数値は `fontVariantNumeric: 'tabular-nums'` を維持

### デザイントークン
`docs/design-system.md` は本リポジトリに存在しないため、`BillingFull.tsx` で実際に使われている
CSS 変数（`--ink` / `--ink-3` / `--rule` / `--rule-strong` / `--accent` / `--white` / `--bg` / `--red` / `--red-pale`）
に限定して使用する。新規カラーは追加しない。

### アクセシビリティ（CLAUDE.md §9・ろう者向け納品のため必須）
- **音声通知なし**（元々なし）
- **色のみで情報を伝えない**：調整済みセルは 色 + `✎` アイコン + `title` 属性テキストの 3 点セットで示す
- ▲▼/↺ に `aria-label`（例：`おやつ等を50円増やす` / `おやつ等を50円減らす` / `おやつ等を自動算出に戻す`）
- **キーボードのみで到達可能**：`<button>` を使いフォーカス可能に保つ。▲▼ は Tab → Enter/Space で操作可
- エラーは既存の日本語エラーバナーに表示

### モバイル対応
▲▼ のタップ標的は最小 24×24px。列幅 90px 内に `▼ 金額 ▲` を収める（`fontSize: 0.78rem` 程度）。

### コード品質（CLAUDE.md §9）
- `console.log` を残さない / `any` 禁止 / コメントは「なぜ」を書く / エラーハンドリング省略禁止

---

## 8. 完成条件

### 正常系
- [ ] おやつ等セルに ▼ / 金額 / ▲ が表示され、初期値が `出席日数 × 50` と一致する
- [ ] ▲ を 1 回押すと +50 円、▼ を 1 回押すと −50 円になる
- [ ] 調整すると「保存（N件未保存）」の N が増える
- [ ] 「保存」後にリロードしても調整値が復元される（`snack_fee_override` の往復）
- [ ] 調整後、請求額列・合計行の「おやつ等」と「請求額」が調整値で再計算される
- [ ] 「↺ 自動に戻す」で `出席日数 × 50` に戻り、保存後もその状態が維持される
- [ ] Excel 出力の「おやつ等」列・合計行が調整値と一致する
- [ ] A4 横印刷で ▲▼/↺ が消え、金額のみが出る（レイアウト崩れなし）

### 異常系・境界値
- [ ] 出席日数 0（自動 = ¥0）で ▼ を押しても **0 未満にならない**（下限クリップ）
- [ ] 調整して保存 → その後 利用表で出席日数を変更 → **おやつ等は固定のまま追従しない**（ユーザー確定の仕様）
- [ ] 調整していない児童は、出席日数の変更に **従来どおり自動追従する**（既存挙動の非回帰）
- [ ] `snack_fee_override` が null の既存月（過去データ）を開いて、**金額が従来と 1 円も変わらない**
- [ ] 児童 0 人の月・イベント 0 件の月でクラッシュしない
- [ ] 保存失敗（RLS 等）時に日本語エラーバナーが出て、画面上の調整値が消えない
- [ ] override = 0 と override = null が**区別される**（0 = 手動で 0 円に固定 / null = 自動）
      ※ `?? ` 演算子の使用を徹底し `||` を使わない（`0 || x` の取り違えが最有力バグ点）

### ローカル確認（CLAUDE.md §2・§9）
- [ ] `npm run dev` で admin スコープ（`/admin/shifts/output/billing`）を確認
- [ ] `npm run dev` で manager スコープ（`/mgr/shifts/output/billing`）を確認
- [ ] `npx tsc --noEmit` が通る
- [ ] `npm run lint` が通る
- [ ] PC・タブレット幅で表示確認
- [ ] キーボードのみで ▲▼/↺ を操作できる

### migration 確認（CLAUDE.md §16）
- [ ] `scripts/apply-migration-221.mjs` を pooler 経由（constraints §2）で実行
- [ ] 適用時に rollback 付きで「override 付き upsert が通る」ことを実証
- [ ] `docs/migration-applied.md` に 221 行を追記
- [ ] Supabase Dashboard での直接編集は**しない**（CLAUDE.md §16-1）

### 将来対応（今回やらない）
- 教材印刷代 / イベント参加費の料金表上編集
- 「おやつ等」列名の可変化
- 事業所ごとのおやつ単価設定
