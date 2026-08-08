# billing-configurable-items（請求項目の可変化 / 兄弟合算 / 他施設利用）

> **Phase B / 承認待ち** — 2026-08-08 調査・設計。Phase A（`billing-event-check-follow.md`）の
> リリース・確認後に着手する（ユーザー選択）。
> ユーザー確定事項: 兄弟は「各行は個別のまま、兄弟ごとの小計行を追加」/ 他施設利用の金額は「請求項目マスタの固定額」。

## 1. 機能概要

### 機能名
`billing-configurable-items`

### 目的

利用料金表の請求項目は現在ハードコードされており、事業所側で足し引きできない。

| 現在の列 | 実体 | 問題 |
|---|---|---|
| おやつ等 | `出席日数 × SNACK_FEE_PER_DAY(50)` + `billing_summaries.snack_fee_override` | 単価も列の有無も変えられない |
| 教材印刷代 | `children.kumon_monthly_fee`（DB 列名は旧称「公文」のまま） | 項目名が固定。抜けない |
| 各イベント | `events`（日付ごと） | ここだけは可変（既存の仕組み） |

これを**「請求項目マスタ」に一般化**し、事業所設定から自由に追加・削除・改名・並べ替えできるようにする。
④「他施設利用」は、この仕組みの `checkbox` 型項目 1 つとして実現する（専用実装を作らない）。

### スコープ（やる）
- **② 請求項目マスタ**: 事業所ごとに請求項目を CRUD。計算方式は 4 種（下表）。計算は自動追従
- **② 既存項目の移行**: おやつ等 / 教材印刷代 を初期シード項目として移行。**保存済み 302 行の金額は 1 円も変えない**
- **③ 兄弟グループ**: `sibling_groups` + `children.sibling_group_id`。料金表に「兄弟」列 + **兄弟ごとの小計行**
- **④ 他施設利用**: `checkbox` 型の項目としてシード。チェック ON でマスタの固定額を加算
- 新ページ **請求項目設定**（`/admin/shifts/billing-items` / `/mgr/shifts/billing-items`）
- 児童設定に「兄弟グループ」欄 + `per_child_monthly` 項目の金額欄（**項目マスタから動的生成**）

### 計算方式（`calc_type`）

| 方式 | 計算 | 該当項目 |
|---|---|---|
| `per_day` | 出席日数 × 単価（▲▼ で調整可・調整するとその月は固定） | おやつ等（単価 50 をシード） |
| `per_child_monthly` | 児童設定で持つ児童ごとの月額 | 教材印刷代 |
| `monthly_fixed` | 事業所共通の月額固定 | 将来の新項目用 |
| `checkbox` | チェック ON でマスタの固定額を加算 | **他施設利用（④）** |

### スコープ（やらない）
| やらないこと | 理由 |
|---|---|
| 保存済み月の金額の変更 | 紙の再印刷で値が変わるのは破壊的変更（CLAUDE.md §7）。移行は数字不変で行う |
| `billing_summaries.snack_fee` / `kumon_fee` / `snack_fee_override` 列の削除 | 適用済みスキーマの破壊を避ける。移行後も互換のため書き続ける |
| `lib/constants.ts` の `SNACK_FEE_PER_DAY` 削除 | 変更に承認が必要（CLAUDE.md §7）。**シード時の初期単価**としてのみ参照を残す |
| 兄弟をまたぐ按分・世帯単位の請求書 PDF 出力 | 今回は料金表上の小計行まで。請求書出力は別フェーズ |
| 児童ごとに「他施設利用」の額を変える | ユーザー確定：マスタの固定額。将来必要なら `per_child_monthly` 項目を足せば済む |
| 事業所をまたぐ項目の共通化 | 施設ごとに独立（CLAUDE.md §1 の「事業所ごとに独立」方針） |

---

## 2. 影響範囲

`docs/constraints.md` 確認済み。**§1 に非該当**（大容量配信なし）。**§2 に該当** — migration の適用は
`scripts/_db.mjs` 経由（pooler + 証明書検証）で行い、`ssl:{rejectUnauthorized:false}` は使わない。

| 種別 | 対象 | 変更内容 |
|---|---|---|
| DB | `public.billing_fee_items`（新規） | 請求項目マスタ（施設スコープ） |
| DB | `public.children_fee_amounts`（新規） | `per_child_monthly` 項目の児童別金額 |
| DB | `public.billing_summary_fee_amounts`（新規） | 児童 × 月 × 項目 の実績・調整・スナップショット |
| DB | `public.sibling_groups`（新規） | 兄弟グループ（施設スコープ・ラベル付き） |
| DB | `public.children` | 列追加 `sibling_group_id uuid null` |
| Migration | `supabase/migrations/222_billing_fee_items.sql` | 上記 4 テーブル + RLS（最新が 221 のため 222 が次番） |
| Migration | `supabase/migrations/223_children_sibling_group.sql` | `children.sibling_group_id` + RLS 確認 |
| Migration 適用 | `scripts/apply-migration-222.mjs` / `-223.mjs` | 新規（pooler 経由・rollback 付き） |
| データ移行 | `scripts/migrate-billing-fee-items.mjs` | シード + 既存 302 行の写し替え（**冪等・dry-run 既定**） |
| 純関数 | `lib/logic/computeBilling.ts` | `resolveFeeAmount()` 追加 / `computeBillingRow` を項目配列ベースに拡張 |
| 型 | `lib/types.ts` | `BillingFeeItemRow` / `FeeCalcType` / `SiblingGroupRow` / `ChildRow.sibling_group_id` 追加 |
| UI（新規） | `components/shift/BillingItemSettingsFull.tsx` | 請求項目設定ページ |
| UI（新規） | `app/(admin)/admin/shifts/billing-items/page.tsx` / `app/(manager)/mgr/shifts/billing-items/page.tsx` | 上記のルート |
| UI | `components/shift/BillingFull.tsx` | 列の動的生成 / 兄弟小計行 / checkbox 列 / 印刷 CSS / Excel 出力の追従 |
| UI | `components/shift/ChildrenSettingsFull.tsx` | 兄弟グループ欄 + `per_child_monthly` 金額欄の動的生成（固定の「教材印刷代」欄を置換） |
| ナビ | `app/(admin)/layout.tsx` / `app/(manager)/layout.tsx` | 設定グループに「請求項目設定」を追加（イベント設定の隣） |
| ドキュメント | `CLAUDE.md` §8 / §10 | 請求項目の可変化を反映 |
| ドキュメント | `docs/reference-map.md` / `docs/migration-applied.md` / `docs/progress.html` | 更新（§14 / §16-2 / §3） |

### 変更しないファイル
- `components/ui/*` — 変更禁止
- `lib/ai-prompts.ts` — 無関係
- 適用済み migration 126 / 127 / 128 / 221 — 触らない（CLAUDE.md §7）
- `lib/logic/attendance.ts` — `isAttended` は無変更（出席日数の定義は据え置き）

---

## 3. データモデル

### 3-1. `billing_fee_items`（請求項目マスタ）

```sql
create table public.billing_fee_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null,
  calc_type text not null check (calc_type in ('per_day','per_child_monthly','monthly_fixed','checkbox')),
  /* per_day=単価/日, monthly_fixed=月額, checkbox=チェック時の加算額。
     per_child_monthly は児童側 (children_fee_amounts) が正で、この列は未使用 */
  unit_amount integer not null default 0 check (unit_amount >= 0),
  /* ▲▼ 1 ステップ幅。null なら unit_amount を 1 ステップとする */
  step_amount integer null check (step_amount is null or step_amount > 0),
  /* 移行で作った組込項目の固定キー: 'snack' | 'material' | 'other_facility'。手動追加は null */
  system_key text null,
  is_active boolean not null default true,
  display_order integer,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, name)
);
```

**削除の扱い**: 過去の月の紙を守るため、既に月次スナップショットを持つ項目は**物理削除せず
`is_active=false`**（＝以後の月の列から外れるが、過去月を開くと保存済みの額はそのまま出る）。
スナップショットを一切持たない項目のみ物理削除を許す。

### 3-2. `children_fee_amounts`（児童別の月額）

```sql
create table public.children_fee_amounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  fee_item_id uuid not null references public.billing_fee_items(id) on delete cascade,
  amount integer not null check (amount >= 0),
  unique (child_id, fee_item_id)
);
```
> `tenant_id` / `facility_id` は CLAUDE.md §7「これらの列を持たないテーブルの作成禁止」に従って必須で持つ。

### 3-3. `billing_summary_fee_amounts`（月次の実績・調整・スナップショット）

```sql
create table public.billing_summary_fee_amounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  billing_summary_id uuid not null references public.billing_summaries(id) on delete cascade,
  fee_item_id uuid not null references public.billing_fee_items(id) on delete cascade,
  /* checkbox 型のみ意味を持つ */
  checked boolean not null default false,
  /* 手動調整額。null = 自動算出（出席日数などに追従）。0 と null は別物なので ?? で判定し || を使わない */
  amount_override integer null check (amount_override is null or amount_override >= 0),
  /* 実効額のスナップショット */
  amount integer not null default 0 check (amount >= 0),
  unique (billing_summary_id, fee_item_id)
);
```

> `snack_fee_override` で確立した「null=自動 / 値あり=固定、`0` と `null` は別物」の規約を
> そのまま一般化する（CLAUDE.md §8）。`||` を使うと `0` が自動に化けるのが最有力バグ点。

### 3-4. `sibling_groups` + `children.sibling_group_id`

```sql
create table public.sibling_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  label text not null,                    -- 例「川島」「◯◯家」。小計行の見出しに使う
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, label)
);

alter table public.children
  add column if not exists sibling_group_id uuid null
    references public.sibling_groups(id) on delete set null;
```

> 実 DB の現児童（active 73 名）には氏名スペース区切りが無いため、**姓の自動推定はしない**。
> 兄弟の紐付けは職員が児童設定で明示的に行う（先頭 2 文字一致で 6 組が候補として観測されたが、
> あくまで参考値であり自動適用はしない）。

### 3-5. RLS（4 テーブル共通）

実 DB の `pg_policies.qual` 本体を probe（[scripts/probe-billing-policies.mjs](../../scripts/probe-billing-policies.mjs)）して確認した
既存の請求系ポリシーと**同一述語**を新規 migration に直接書く（migration 140 の上書きに依存しない）。

```sql
-- admin
using (get_my_role() = 'admin' and tenant_id = get_my_tenant_id())
-- manager + shift_manager
using (
  get_my_role() = any (array['manager','shift_manager'])
  and tenant_id = get_my_tenant_id()
  and facility_id in (select get_my_managed_facility_ids())
)
```
`billing_summary_fee_amounts` は自身が `facility_id` を持つため、親 join ではなく自列で判定する
（`billing_event_participations` の `exists` 方式より単純で、行レベルで閉じる）。

---

## 4. 既存データの移行（数字不変が絶対条件）

`scripts/migrate-billing-fee-items.mjs`（**既定 dry-run。`--apply` で実行。冪等**）

| # | 処理 | 数字への影響 |
|---|---|---|
| 1 | 事業所ごとに `おやつ等`(per_day, unit=50, key='snack') / `教材印刷代`(per_child_monthly, key='material') / `他施設利用`(checkbox, unit=0, key='other_facility', is_active=false) をシード | なし |
| 2 | `children.kumon_monthly_fee > 0` を `children_fee_amounts`(material) へ写す | なし（同額） |
| 3 | 既存 `billing_summaries` 302 行 × 2 項目を `billing_summary_fee_amounts` へ写す（snack: `amount=snack_fee, amount_override=snack_fee_override` / material: `amount=kumon_fee`） | **なし（スナップショットをそのまま複製）** |
| 4 | 検証: 移行後の `Σ amount` が旧 `Σ(snack_fee + kumon_fee)` と一致することを assert | 不一致なら中断 |

`他施設利用` は `is_active=false` でシードし、事業所が金額を設定して有効化した時点で列が現れる
（未設定のまま ¥0 の列が全事業所に出るのを避けるため）。

**移行後も** `billing_summaries.snack_fee` / `kumon_fee` / `snack_fee_override` には対応する
`system_key` 項目の値を書き続ける（外部から読む処理が将来現れても壊れないようにする互換書き込み）。

---

## 5. 純関数（`lib/logic/computeBilling.ts`）

```ts
export type FeeCalcType = 'per_day' | 'per_child_monthly' | 'monthly_fixed' | 'checkbox';

/** 1 項目の実効額（円）。表示・印刷・Excel・保存はすべてこの関数を通す（式を UI 側で再実装しない） */
export function resolveFeeAmount(
  item: { calcType: FeeCalcType; unitAmount: number },
  value: { checked: boolean; amountOverride: number | null; childAmount: number | null },
  attendanceDays: number,
): number
```

| calcType | 戻り値 |
|---|---|
| `per_day` | `amountOverride ?? max(0, attendanceDays) * unitAmount` |
| `per_child_monthly` | `amountOverride ?? childAmount ?? 0` |
| `monthly_fixed` | `amountOverride ?? unitAmount` |
| `checkbox` | `checked ? (amountOverride ?? unitAmount) : 0` |

- 既存の `resolveSnackFee` / `computeDefaultSnackFee` / `stepSnackFee` は
  `per_day` の特例に過ぎなくなるため、`resolveFeeAmount` / 汎用 `stepFeeAmount` へ**統合して置換**する
  （二重定義を残さない。CLAUDE.md §8 の「参照は `computeBilling.ts` のみ」を維持）
- `computeBillingRow` は `items: FeeItemInput[]` / `values: FeeValueInput[]` を受け取る形へ拡張し、
  `snackFee` / `kumonFee` の固定フィールドを `feeBreakdown: Array<{itemId, amount}>` に置き換える

---

## 6. UI

### 6-1. 請求項目設定（新規ページ）

`components/shift/BillingItemSettingsFull.tsx`。`EventSettingsFull.tsx` の CRUD パターンを踏襲。

| 列 | 内容 |
|---|---|
| 並び順 | ▲▼ で `display_order` |
| 項目名 | テキスト（例「おやつ等」） |
| 計算方式 | セレクト（4 種。**移行済み組込項目は方式変更不可**＝過去月の意味が変わるため） |
| 単価 / 金額 | 円。`per_child_monthly` は「児童設定で入力」と表示して無効化 |
| ▲▼ 幅 | `step_amount`（空欄なら単価と同じ） |
| 有効 | チェック。OFF で以後の月の列から外れる |
| 削除 | スナップショットを持つ項目は削除不可（理由をその場に表示）→ 「有効 OFF」を案内 |

### 6-2. 児童設定（既存の改修）

- 固定の「✏️ 教材印刷代 月額」欄を廃し、**`per_child_monthly` 項目ぶんの金額欄を動的生成**
- 「👨‍👩‍👧 兄弟グループ」欄を追加（既存グループから選択 / 新規作成 / 解除）
- 一覧にも「兄弟」列を出し、同グループの児童名をツールチップ表示

### 6-3. 利用料金表（既存の改修）

列構成（左→右）:

```
# / 市町村 / 氏名 / 兄弟 / 出席日数 / 利用負担額 / 〔請求項目 …動的〕 / 〔イベント …動的〕 / 参加費合計 / 請求額 / 受取日
```

- **請求項目列**は `is_active=true` の項目を `display_order` 順に生成。
  `per_day` / `monthly_fixed` は ▲▼ + ↺（現行のおやつ UI をそのまま一般化）、
  `checkbox` はチェックボックス + 金額、`per_child_monthly` は読み取り専用表示
- **兄弟列**: グループのラベルを表示。未設定は空欄
- **兄弟小計行**（③・ユーザー確定）: 兄弟グループの最終行の直下に
  `〔ラベル〕 きょうだい小計 ¥X` の行を挿入。**各児童の行は個別金額のまま**
  - 児童の並び順は既存の `display_order` を維持しつつ、**同一グループが隣接するよう安定ソート**する
    （グループ未所属の子の順序は変えない）
  - 全体合計行は**児童行のみ**を足す（小計行を足すと二重計上になる。ここが本機能の最有力バグ点）
- 印刷（A4 横）: 列が増えるため `data-density` の閾値を「イベント数」から**「動的列の総数」**に変更
- Excel 出力: ヘッダ・列幅・合計行を動的列数に追従。小計行は太字 + 塗りで区別

---

## 7. 連動ポイント（CLAUDE.md §12）

| 変更箇所 | 確認が必要な箇所 |
|---|---|
| `lib/types.ts` 型追加 | `BillingFull` / `ChildrenSettingsFull` / `BillingItemSettingsFull` |
| 新テーブル 4 つ | RLS 設定 + `lib/types.ts` + `docs/reference-map.md`（§14） |
| `children.sibling_group_id` | `ChildrenSettingsFull` / `BillingFull` / `reference-map.md` |
| `computeBilling.ts` の署名変更 | `BillingFull.tsx`（唯一の呼び出し元であることを実装時に grep で再確認） |
| `SNACK_FEE_PER_DAY` の役割変更 | `lib/constants.ts` はコメントのみ変更。値は据え置き（承認不要な範囲に留める） |
| ナビ追加 | `app/(admin)/layout.tsx` / `app/(manager)/layout.tsx` の `shift_only_mode` 許可リスト |

---

## 8. ロール別の権限

| ロール | 請求項目設定 | 児童設定（兄弟・金額） | 料金表 |
|---|---|---|---|
| admin | 全事業所 可 | 可 | 可 |
| manager | 自事業所 可 | 可 | 可 |
| shift_manager | **編集可**（自事業所） | 既存の児童編集 RPC の範囲に準ずる（migration 214） | 可 |
| employee | 不可 | 不可 | 不可 |

> `shift_manager` の請求項目マスタ編集は **2026-08-08 ユーザー承認により「編集できてよい」で確定**。
> CLAUDE.md §4 の「事業所/権限設定は不可」は事業所そのものの設定・権限管理を指し、
> 請求項目は shift_manager の担当範囲である帳票（利用料金表）の内容側と整理する。
> よって新規 4 テーブルの RLS は既存の請求系と同じく
> `get_my_role() = any (array['manager','shift_manager'])` の `for all` とし、
> 閲覧限定の分岐は設けない（`shift_requests` のような専用 SELECT ポリシーは不要）。

---

## 9. 実装ステップ（提案）

| # | ステップ | 成果物 |
|---|---|---|
| B-1 | migration 222 / 223 + apply スクリプト | 4 テーブル + `children.sibling_group_id` + RLS |
| B-2 | データ移行（dry-run → 検証 → apply） | 302 行の写し替え・金額一致の assert |
| B-3 | `computeBilling.ts` の一般化 | `resolveFeeAmount` / `stepFeeAmount` / `computeBillingRow` |
| B-4 | 請求項目設定ページ + ナビ | 新ページ 2 ルート + コンポーネント |
| B-5 | 児童設定の改修 | 兄弟グループ欄 + 動的金額欄 |
| B-6 | 料金表の改修 | 動的列 / 兄弟小計行 / checkbox 列 / 印刷 / Excel |
| B-7 | 動作確認・ドキュメント更新 | progress.html / reference-map / migration-applied / error-log |

---

## 10. 動作確認（CLAUDE.md §9）

| # | 確認項目 | 期待 |
|---|---|---|
| 1 | 移行直後に 2026-07 を開く | **移行前と 1 円も変わらない** |
| 2 | 項目「おやつ等」の単価を 50→60 に変更 | **未保存の月のみ**追従。保存済み月は不変 |
| 3 | 項目を新規追加 | 当月から列が増え、合計・請求額に追従 |
| 4 | 項目を「有効 OFF」 | 以後の月の列から消える。過去月を開くと保存済み額はそのまま |
| 5 | スナップショットを持つ項目の削除 | 拒否され、理由が日本語で表示される |
| 6 | 他施設利用にチェック | マスタの固定額が請求額に加算される |
| 7 | 兄弟 2 名を同グループに | 行が隣接し、直下に小計行。**全体合計は二重計上されない** |
| 8 | 兄弟 3 名 / 単独児 混在 | 小計は 3 名合算。単独児は小計行なし |
| 9 | 印刷（A4 横） | 列 15 超でも 1 ページ幅に収まる |
| 10 | Excel 出力 | 動的列・小計行・合計が画面と一致 |
| 11 | 異常系: 項目 0 件 | 列なしでもエラーにならない |
| 12 | 異常系: `amount_override=0` | ¥0 として固定される（自動算出に戻らない）＝ `??` 判定の確認 |
| 13 | shift_manager | §8 で確定した権限どおり |

---

## 11. 別視点確認（CLAUDE.md §3）

- **二重計上**: 兄弟小計行を全体合計に入れない。参加費合計列も既に「請求額に含む別列」なので同種の罠がある
- **過去月の不変性**: 項目マスタは「今後の月」にだけ効く。過去月はスナップショットが正
- **`0` と `null`**: `amount_override` は `??` で判定。`||` を書いた瞬間に手動 0 円が自動算出に化ける
- **移行の冪等性**: 再実行しても重複シード・二重計上が起きないこと（`unique` 制約 + upsert で担保）
