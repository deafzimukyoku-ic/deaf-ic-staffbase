# 利用表 改善（全幅化 / スクロールバー / 利用合計 / 自由入力3行 / マス寸法 / 日付ロジック統一）

- **起点**: 先方要望（2026-09-08、スクリーンショット4枚）
- **migration**: 226（`schedule_day_notes` / `schedule_day_note_labels` 新設・追加のみ）
- **対象ロール**: admin / manager / shift_manager（employee 画面は変更なし）

---

## ① 枠の全幅化（利用表の左右に余白が出る）

### 真因

`(admin)` / `(manager)` layout のコンテンツ枠が `mx-auto w-full max-w-7xl p-6 lg:p-8`。
表系の画面は `-m-6 lg:-m-8` で**パディングだけ**打ち消していたが、`max-w-7xl`（=1280px）の
中央寄せは残るため、1280px を超える表示幅（ブラウザ 75% ズーム等）で表の左右に余白が出ていた。

### 対応

`lib/layout/full-bleed-routes.ts` に `isFullBleedRoute(pathname)` を新設し、両 layout から使う。
対象ルートのみ `max-w-7xl` → `max-w-none`。

| 対象（admin / mgr 両系統） | 非対象（1280px 中央寄せのまま） |
|---|---|
| `/shifts`（シフト表・**完全一致**）, `/shifts/schedule`, `/shifts/transport`, `/shifts/events` | `/shifts/dashboard`, `/shifts/facility-settings`, `/shifts/staff-settings`, `/shifts/billing-items` |
| `/shifts/output/{daily,daily-report,billing,staff-child-overlap,weekly-transport}` | 社員管理・設定・研修・お知らせ等すべて |

`/shifts` を**完全一致**で判定しているのが要点。`startsWith` にすると設定系まで全幅になる。
末尾スラッシュは正規化して吸収する。

---

## ② スクロールバーを太くする

### 真因

`app/globals.css` のグローバル指定が `::-webkit-scrollbar { width: 5px }` で **`height` 未指定**。
その結果、縦は 5px・横は Chrome 既定の 15px という**バラバラな太さ**になっていた（実測で確認）。

### 対応

`.grid-scroll` を新設し、表・帳票のスクロール枠 6 箇所に付与（縦横とも 12px）。

### 地雷（重要）

**Chrome は同じ要素に `scrollbar-width` / `scrollbar-color`（標準プロパティ）が指定されていると
`::-webkit-scrollbar` 系の指定をまるごと無視し、標準スクロールバー（15px）を描く。**

localhost:6001 での実測:

| 指定 | 縦 | 横 |
|---|---|---|
| 何もなし（グローバルの 5px のみ） | 4px | 15px |
| `::-webkit-scrollbar{width:12px;height:12px}` のみ | **12px** | **12px** |
| 上記 + `scrollbar-width:auto; scrollbar-color:…` | 15px | 15px |

初回実装で標準プロパティを併記して不発になった。**`.grid-scroll` には標準プロパティを書かない。**
Firefox は既定の `auto`（十分な太さ）のままとなり、実用上の問題はない。

なお既存の `.sidebar-scroll` も同じ理由で webkit 指定 8px が効かず標準の 10px になっているが、
今回のスコープ外のため触っていない。

---

## ③ 利用合計（その月の合計）

`ScheduleGridFull` の「利用数」行の左端固定セルに `計 N` を併記。キャンセル待ち行にも `計 M`。

- 値は `dailyCounts` / `dailyWaitlistCounts` の**総和**なので、判定基準は日別セルと完全に一致する
  （`lib/logic/attendance.ts` の `isAttended` / `isWaitlist` 準拠。CLAUDE.md §10）
- 列を増やさないので A3 横の印刷レイアウトは無変更

---

## ④-a 利用表の自由入力3行

日付ヘッダと児童行の間に3行。実装はシフト表 `ShiftGridFull` と同型
（非制御 `defaultValue` + `onBlur` 保存、`key` に保存値を含めて refetch 時のみ remount）。

### 保存先はシフト表と別（migration 226）

`schedule_day_notes` / `schedule_day_note_labels` を新設し、**シフト表とは独立**させた。

- 当初は `shift_day_notes` を共用する実装にした（二重入力を避ける狙い）が、
  先方指示（2026-09-08「利用表の自由入力3行はシフトとは別で入力可能にしてほしい」）で別テーブルへ変更
- 同じ日でも「シフト作成者に伝えたいこと」と「利用予定側の申し送り」は別物、という運用
- 構造・制約・RLS は 219/220 と**完全に同型**（将来どちらかを直すときに差分を考えなくて済むように）
- 適用検証で、同じ (施設, 日付, 行番号) に対して両テーブルが別々の値を保持できることを実証済

---

## ⑤ マス（セル）の寸法をシフト表に合わせる

先方指示（2026-09-08）。利用表だけマスが大きく、シフト表と並べたときに揃っていなかった。

| 項目 | 変更前（利用表） | 変更後 = シフト表 |
|---|---|---|
| 日付列の最小幅 | 80px | **56px** |
| テーブル最小幅 | `日数×80 + 160` | `日数×56 + 180` |
| データセルの padding | `px-1 py-1` | `px-0.5 py-1` |
| 時刻の文字サイズ | 0.72rem | **0.62rem** |
| 「欠席 / お休み / キャ待」ラベル | `text-xs`(0.75rem) | 0.62rem |
| 氏名セルの構成 | 氏名 / 学年 / 出席数 の**3行** | 氏名+学年バッジ / 出席数 の**2行** |
| 学年 | 独立した行（0.7rem） | 氏名の右の小バッジ（0.6rem・`.schedule-grade-badge`） |

氏名セルを 2 行に詰めたのが行高を揃える要点。3 行のままだと利用表だけ約 20px 高くなる。

### 実測（両グリッドを同一ページに並べて計測）

| 項目 | 利用表 | シフト表 |
|---|---|---|
| 日付列の幅 | 56.7px | 56.7px |
| 氏名列の幅 | 160px | 160px |
| データ行の高さ | **57.3px** | **57.3px** |
| メモ行の高さ | 27px | 27px |
| **日付ヘッダの高さ** | **59px** | **59px** |

日付ヘッダは当初 67.6px / 54.4px と差が残っていたが、④-b (iii) で書式自体をシフト表に
合わせたことで完全に一致した。曜日の文字色（土=青 / 日・祝=赤 / 平日=`var(--ink-2)`）も
計算値レベルで一致することを確認済み。

### 印刷 CSS の追随

氏名セルの構造を変えたため、学年を紙で落とす旧セレクタ
`tbody td:first-child > div:nth-child(2)` が当たらなくなった。
`.schedule-grade-badge` を付けて指定し直している（出席数は従来どおり印字する）。

---

## ④-b 日付表示ロジックの統一

### (i) モーダル題名

| 画面 | 変更前 | 変更後 |
|---|---|---|
| 利用表 `ScheduleFull` | `9月8日（火）` | 変更なし |
| シフト表 `ShiftFull` | `9/8（火）` | `9月8日（火）` |

### (ii) 祝日判定（利用表だけ抜けていた）

グリッド系コンポーネントのうち `ScheduleGridFull` **だけ** `isJpHoliday` を使っておらず、
`営 / 休` を `dow === 0 || dow === 6` だけで判定していた。

一方、**同じ利用表**のセル編集モーダルは `inferChildDefaultTimes` → `isWeekendOrHoliday`（土日**祝**）で
初期時刻を出しているため、画面の中で基準が食い違っていた。

- 例（2026年9月）: 9/21 敬老の日 / 9/22 休日 / 9/23 秋分の日 が
  ヘッダ「営」なのに初期時刻は土日祝の 09:30 系

`isWeekendOrHoliday()` に統一し、祝日を休み扱いにした。

### (iii) 日付ヘッダの書式（シフト表を正とする）

先方指示（2026-09-08）「ここの日付が違うのも気になるのでシフトが正で利用表を合わせて」。

| 行 | 変更前（利用表） | 変更後 = シフト表 |
|---|---|---|
| 1 行目 | `営` / `休`（0.65rem・opacity 0.6） | **曜日**（`水`・0.65rem・opacity 0.6） |
| 2 行目 | `9/2`（月+日） | **日のみ**（`2`） |
| 3 行目 | `(水)` | **利用者数**（`10人` + キャンセル待ち `待N`） |
| 文字色 | `getDowStyle`（背景 tint 付き） | `getDowColor`（シフト表と同一実装。日曜・祝日=赤 / 土曜=青 / 平日=`var(--ink-2)`） |

`営 / 休` の表示は無くなるが、**学校が休みかどうかは曜日の色（日曜・祝日=赤 / 土曜=青）と
`title` ツールチップ（例: 「敬老の日 / 学校休み」）で残している**。

### 印刷 CSS の追随（重要）

旧 CSS は `thead th > div:first-child, div:last-child` を隠して `9/2` だけ印字していた。
新構成では**利用者数の行が無い日（0人）に `:last-child` が日付そのものを指してしまう**ため、
`:nth-child(1)` と `:nth-child(3)` に変更した。紙には日の数字だけが出る（月は表題「2026年9月 利用表」に出る）。

### (iv) 曜日色が一度も効いていなかったバグ（調査中に発見）

ヘッダ `th` の style が

```
...getDowStyle(d.dow),
color: isTodayCol ? 'var(--accent)' : undefined,
```

の順で、**オブジェクトリテラルは値が `undefined` でも後勝ちでキーを上書きする**ため、
`getDowStyle` が返した日曜=赤 / 土曜=青が常に潰されていた（利用表のヘッダは全て既定色だった）。
`...(isTodayCol ? { color: 'var(--accent)' } : {})` に一旦変更して解消し、
その後 (iii) でヘッダをシフト表と同型にした際に `color: isTodayCol ? … : getDowColor(…)` の
単一プロパティへ整理した（スプレッドと後勝ちキーの併用自体をやめた）。

---

## 連動ポイント

| 変更箇所 | 確認したファイル |
|---|---|
| `ScheduleGridFull` の props 追加 | 呼び出しは `ScheduleFull` のみ |
| `.grid-scroll` 付与 | ScheduleGridFull / ShiftGridFull / TransportFull / BillingFull / WeeklyTransportFull / DailyOutputFull |
| `max-w-7xl` の条件化 | `(admin)/layout.tsx` / `(manager)/layout.tsx`（`(employee)` は対象外） |
| 印刷 CSS | `ScheduleFull` の `@media print` にメモ input の枠消し + `.schedule-grade-badge` 非表示 |
| migration 226 | `supabase/migrations/226_schedule_day_notes.sql` / `scripts/apply-migration-226.mjs` / `docs/migration-applied.md` |
