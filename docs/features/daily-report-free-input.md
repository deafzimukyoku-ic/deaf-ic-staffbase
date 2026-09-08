# 業務日報「活動内容／連絡事項」の日別自由入力 + 利用表メモの取り込み

- **起点**: 先方要望（2026-09-08）「業務日報って自由入力できる？」→ A+B 採用
- **migration**: 227（`daily_report_notes` 新設・追加のみ）
- **対象ロール**: admin / manager / shift_manager（employee はこの画面に入れない）

---

## 変更前の状態（調査結果）

「活動内容／連絡事項」枠の中身は `facilities.daily_report_template`（migration 121）だけだった。

| 項目 | 変更前 |
|---|---|
| 単位 | **事業所ごとに 1 つの固定テンプレート**（日付ごとには持てない） |
| 編集場所 | `/admin/settings`（**admin のみ**。manager / shift_manager は編集不可） |
| 表示 | 全日付に同じ文言。空なら白紙（印刷してから手書きする前提） |

つまり「その日の活動を記録する場所」が存在しなかった。

---

## 変更後: 枠は 3 段構成

| 段 | 中身 | 出どころ | 編集 |
|---|---|---|---|
| 1 | 事業所共通の定型文 | `facilities.daily_report_template`（121） | `/admin/settings`（従来どおり） |
| 2 | 利用表のメモ3行 | `schedule_day_notes` + `schedule_day_note_labels`（226） | **参照のみ**（編集は利用表で） |
| 3 | この日の自由入力 | `daily_report_notes`（**227・新規**） | **この画面で直接入力** |

### A: 日別自由入力（`daily_report_notes`）

- 「施設 × 日付」で 1 レコード。行番号は持たない（枠は 1 つの自由記述欄なので）
- 非制御 `<textarea>` + `onBlur` 保存。利用表・シフト表のメモ行と同じ方式に揃えた
- 空文字は DELETE（ゴミ行を残さない）
- 枠の残り高さいっぱいまで広がる（`flex: 1`）ので、白紙部分がそのまま入力領域になる
- 保存失敗は**画面上部にインラインで赤帯表示**する。この画面はトースト基盤を持たないため、
  黙って失敗すると保存されていないまま印刷される事故になる。音は使わず色＋アイコン＋日本語（CLAUDE.md §9）

### B: 利用表メモの取り込み

- 期間内の `schedule_day_notes` を日付ごとに引き、行ラベルを添えて表示する
- **ラベルは「施設 × 月 × 行番号」**なので、期間が月をまたぐときは対象月をすべて引く必要がある
  （`listDates()` から distinct な `YYYY-MM` を作って `in` で取得）
- 左罫線で区切って「よそから来た情報」だと分かるようにしている（ここでは編集不可）

### 印刷

`<textarea>` をそのまま印刷すると**入力欄の高さを超えた行が切れる**。
画面用 `<textarea class="no-print">` と印刷用 `<div class="activity-print-note print-only">` を出し分ける。

Excel 出力（`buildDayXlsxBuffer`）も 3 段を改行で連結して 1 セルに入れる。
片方だけ欠けると紙と Excel で突き合わせができなくなるため。

---

## 印刷レイアウト崩れの修正（同日報告）

### 症状

印刷プレビューで全体が少し縮小され、余白が広くなる。

### 真因

親レイアウトのコンテンツ枠 `mx-auto w-full max-w-* p-6 lg:p-8 pb-24` の**左右パディングが紙にも残っていた**。

- `.report-page` は `width: 194mm` 固定（A4 210mm − `@page margin: 8mm` × 2 = 印刷可能幅ぴったり）
- そこに枠の padding が加わると印刷可能幅を超える → **Chrome がページ全体を縮小して収める**

Playwright の print メディアエミュレーションで実測:

| メディア | 枠の左右 padding | `.report-page` | 必要幅 |
|---|---|---|---|
| screen（修正前と同じ状態） | 32px / 32px | 194mm | **210.9mm**（194mm を超過） |
| print（修正後） | 0px / 0px | 194mm | **194mm**（ぴったり） |

### 対応

両 layout のコンテンツ枠に `app-content-frame` クラスを付け、
業務日報の `@media print` でその余白を打ち消す。

```css
@media print {
  .app-content-frame { padding: 0 !important; margin: 0 !important; max-width: none !important; }
}
```

**シフト表・利用表・送迎表は画面側の `-m-6 lg:-m-8` で相殺しているのでこの rule は要らない。**
業務日報は A4 用紙を中央寄せする画面で負マージンが使えないため、印刷時のみ打ち消す。
この `<style jsx global>` は業務日報を表示している間しか挿入されないので、他画面には影響しない。

---

## 連動ポイント

| 変更箇所 | 確認したファイル |
|---|---|
| `daily_report_notes` 追加 | `supabase/migrations/227_daily_report_notes.sql` / `scripts/apply-migration-227.mjs` / `docs/migration-applied.md` |
| `ActivityBox` の props 変更 | 呼び出しは `DailyReportFull` 内のみ |
| `app-content-frame` クラス追加 | `(admin)/layout.tsx` / `(manager)/layout.tsx`（クラスを足すだけで screen の見た目は不変） |
| Excel 出力 | `buildDayXlsxBuffer` の deps に `scheduleNotes` / `dayNotes` を追加（古い値で出力しないため） |
| 利用表メモの参照 | `schedule_day_notes` / `schedule_day_note_labels`（226）。利用表側の仕様は docs/features/schedule-fullwidth-notes-total.md |
