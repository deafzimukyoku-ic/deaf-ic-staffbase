# billing-event-check-follow（利用料金表 イベント交差セルのチェックを利用表に追従させる）

> **Phase A / 承認待ち** — 2026-08-08 調査。方針はユーザー選択済み
> （「未保存イベントのみ自動 + ズレ警告」「①を先に単独リリース」）。
> Phase B（請求項目マスタ / 兄弟 / 他施設利用）は `billing-configurable-items.md` に分離。

## 1. 機能概要

### 機能名
`billing-event-check-follow`

### 背景（調査で判明した事実）

利用料金表の「イベント × 氏名」交差セルのチェックは、**料金表をまだ一度も保存していない月だけ**
出席実績から自動生成される。保存済みの月では保存値が正となり、その後の利用表の修正にも
イベント追加にも一切追従しない。該当は [BillingFull.tsx:232-241](../../components/shift/BillingFull.tsx#L232)。

```ts
for (const ev of evs) {
  if (existing) {
    participations[ev.id] = partsMap.get(ev.id) ?? false;   // 保存済み → 保存値が正
  } else {
    participations[ev.id] = attendedSet.has(attendedKey(c.id, ev.date)); // 未保存 → 出席から自動
  }
}
```

| 状況 | 現在のチェック | 問題 |
|---|---|---|
| 料金表 未保存の月 | 出席実績があれば自動 ON | 問題なし（意図どおり） |
| 保存済み → 利用表を修正 | 追従しない | 職員が気づけない |
| **保存済み → イベントを追加** | **常に OFF**（出席していても OFF） | `partsMap` に行が無く `?? false` に落ちる。**最も実害が大きい** |

### 実 DB での実測（2026-08-08 / [scripts/probe-billing-event-check.mjs](../../scripts/probe-billing-event-check.mjs)）

| 指標 | 件数 |
|---|---|
| `billing_summaries` | 302 行 |
| `billing_event_participations` | 1,702 行（うち `participated=true` 380） |
| **出席あり × チェック OFF** | **100 件**（請求漏れ side） |
| 出席なし × チェック ON | 12 件（職員の意図的チェックの可能性） |
| **保存済みサマリに participations 行が無い** | **52 件**（保存後にイベント追加） |

> ⚠️ 初回 probe は PostgREST の既定上限 1000 行に当たって件数を誤っていた。
> ページングを入れて再取得した上記が正。**件数を数える probe は必ず `.range()` でページングする。**

「出席なし × チェック ON」が 12 件実在するため、**無条件に出席実績で上書きすると職員の手入力を壊す**。
よって「補完はするが上書きはしない」方針を採る。

### スコープ（やる）
- 保存済みの月でも、**`billing_event_participations` に行が無いイベント**は出席実績から初期値を作る（52 件が解消）
- 利用表の出席実績とチェックがズレている行を**視覚的に警告**（色 + アイコン + テキストの 3 点。CLAUDE.md §9）
- 「出席実績に合わせる」**一括ボタン**で、ズレているセルだけを出席実績に合わせる（押すまで何も変わらない）
- 画面下の注記「※ イベント参加チェックは初期値 OFF」が**コードと矛盾している**ので実態に合わせて修正

### スコープ（やらない）
| やらないこと | 理由 |
|---|---|
| 保存済みチェックの自動上書き | ユーザー選択。「出席なし × ON」12 件の手入力を壊すため |
| DB スキーマの変更 | 本 Phase は**クライアント内のロジックのみ**で完結する。migration 不要 |
| 出席判定ロジック (`isAttended`) の変更 | 現行の一元化（CLAUDE.md §10）を維持 |
| 請求項目の可変化 / 兄弟 / 他施設利用 | Phase B（`billing-configurable-items.md`）に分離 |

---

## 2. 影響範囲

`docs/constraints.md` 確認済み。**§1（Vercel Function 経由の大容量配信）/ §2（Supabase は pooler 経由）
のいずれにも抵触しない**。本件は既存クライアントコンポーネント内の分岐追加のみで、
**DB 変更・新規 API ルート・大容量転送のいずれも発生しない**。

| 種別 | 対象 | 変更内容 |
|---|---|---|
| UI | `components/shift/BillingFull.tsx` | `RowState` に `attendedByEvent` 追加 / participations 初期値の分岐修正 / ズレ警告バッジ / 一括ボタン / 注記修正 |
| ドキュメント | `docs/features/billing-event-check-follow.md` | 本ファイル（新規） |
| ドキュメント | `docs/reference-map.md` | `BillingFull.tsx` の行に「participations の初期値は保存値 → 無ければ出席実績」を追記 |
| ドキュメント | `docs/progress.html` | 本機能の行を追加（CLAUDE.md §3） |
| 調査 | `scripts/probe-billing-event-check.mjs` | 残置（再確認可能にする。CLAUDE.md §16-2） |

### 変更しないファイル（誤爆防止のため明記）
- `supabase/migrations/*` — **migration なし**
- `lib/logic/computeBilling.ts` — 純関数は無変更（participations は BillingFull のローカル状態）
- `lib/logic/attendance.ts` — `isAttended` は無変更
- `lib/constants.ts` / `lib/types.ts` — 無変更
- `components/shift/EventSettingsFull.tsx` / `ChildrenSettingsFull.tsx` — 無変更
- `components/ui/*` — 変更禁止

---

## 3. 実装内容

### 3-1. participations 初期値の分岐修正

`?? false`（行が無い＝未チェック）を `has()` 判定に変える。**行が存在するときだけ保存値を尊重**し、
存在しないときは未保存月と同じく出席実績から作る。

```ts
let filledFromAttendance = false;
for (const ev of evs) {
  if (existing && partsMap.has(ev.id)) {
    /* 保存済みの明示値（false 含む）は職員の判断なので尊重する */
    participations[ev.id] = partsMap.get(ev.id)!;
  } else {
    /* 未保存月、または保存後に追加されたイベント → 出席実績から初期値 */
    participations[ev.id] = attendedSet.has(attendedKey(c.id, ev.date));
    if (existing) filledFromAttendance = true;
  }
}
```

`filledFromAttendance` が立った行は `dirty` にして「保存」で永続化できるようにする：

```ts
dirty: !existing || existing.attendance_days !== attendanceDays || filledFromAttendance,
```

### 3-2. ズレ警告

`RowState` に `attendedByEvent: Record<string, boolean>`（そのイベント日に出席実績があるか）を保持し、
`participations[evId] !== attendedByEvent[evId]` のセルをズレとして扱う。

- セル: 出席ありなのに OFF → `⚠` + 色 + `title` に理由。出席なしなのに ON → `＋` + 色 + `title`
- ヘッダ行: ズレ総数を「⚠ 利用表とズレ N件」で表示し、隣に「出席実績に合わせる」ボタン
- **色だけで伝えない**（CLAUDE.md §9）: アイコン + `title` + 集計テキストを併用
- 印刷 / Excel には出さない（`print-hide`）。紙は確定値のみ

### 3-3. 一括「出席実績に合わせる」

押下時のみ、ズレているセルを `attendedByEvent` の値へ揃えて `dirty` を立てる。
DB 保存は既存の「保存」ボタンを通す（挙動を二重化しない）。

### 3-4. 注記の修正

現行の「※ イベント参加チェックは初期値 OFF。当月実績に応じてチェックしてください。」は**事実と異なる**。
実態（出席実績から自動 ON / 保存後は保存値が正 / ズレは警告表示）に合わせて書き換える。

---

## 4. 連動ポイント（CLAUDE.md §12）

| 変更箇所 | 確認が必要な箇所 | 本件での影響 |
|---|---|---|
| `BillingFull.tsx` の participations 初期値 | 保存 (`handleSave`) の全置換ロジック | 変更なし。dirty 判定のみ増える |
| 出席判定 | `lib/logic/attendance.ts` `isAttended` | 参照のみ。変更なし |
| 印刷 / Excel 出力 | 同ファイル内 `handleDownloadExcel` / print CSS | 警告 UI は `print-hide` のため紙面は不変 |
| ロール | admin / manager / shift_manager | RLS 変更なし。既存 `bep_manager_facility`（shift_manager 含む・probe 実証済）のまま |

---

## 5. ロール別の見え方

| ロール | 料金表 | 本機能 |
|---|---|---|
| admin | 全事業所 | 利用可 |
| manager | 自事業所 | 利用可 |
| shift_manager | 主所属1事業所 | 利用可（`bs_manager_facility` / `bep_manager_facility` が `ANY(ARRAY['manager','shift_manager'])` であることを実 DB の `pg_policies.qual` で確認済。CLAUDE.md §4 の「ポリシー名でロールを判断しない」に従い本体で確認した） |
| employee | 不可 | 対象外 |

---

## 6. 動作確認（CLAUDE.md §9）

| # | 確認項目 | 期待 |
|---|---|---|
| 1 | 未保存の月を開く | 従来どおり出席実績から自動 ON |
| 2 | 保存済み 2026-08 パズル を開く | 保存後に追加されたイベント列にチェックが入る（52 件側の解消） |
| 3 | 出席あり × 保存済み OFF の行 | ⚠ バッジが出る。**勝手にチェックは入らない** |
| 4 | 「出席実績に合わせる」押下 | ズレたセルだけ揃う。押すまで無変化 |
| 5 | 保存 → 再読込 | 揃えた値が永続化され、ズレ件数 0 |
| 6 | 印刷 / Excel | 警告 UI が出ない。金額は画面と一致 |
| 7 | 異常系: イベント 0 件の月 | 警告なし・エラーなし |
| 8 | shift_manager でログイン | 表示・保存とも可能 |

---

## 7. 別視点確認（CLAUDE.md §3）

- **請求漏れ方向に倒れていないか**: 補完は「行が無いとき」のみ。既存の明示 `false` は温存するため、
  職員が意図的に外したチェックが自動で復活することはない
- **紙の再現性**: 保存済みの月を開いただけでは DB は変わらない。数字が動くのは職員が「保存」を押したときのみ
- **`dirty` の増加**: 52 件が乗る月は「保存（N件未保存）」と出る。これは意図どおり（保存を促す）
