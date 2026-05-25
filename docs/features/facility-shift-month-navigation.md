# facility-shift-month-navigation

> **対象リポ**: deaf-ic + diletto-new-staffbase 両方で同形実装
> **ステータス**: 承認済 (ユーザー検証フェーズ)
> **起票**: 2026-05-25

## 1. 機能概要

- **機能名**: facility-shift-month-navigation
- **目的**: 社員側「施設のシフト」ビューが**今月固定**で過去/未来月のシフトを確認できない問題を解消し、休み希望ビューと同じ要領で**前月/今月/翌月**に切替できるようにする
- **スコープ (やる)**:
  - `MyFacilityShiftView` に `MonthStepper` を組み込み、URL `?month=YYYY-MM` で対象月を制御
  - 月送り範囲を **現在月 ± 1 ヶ月 (前月 / 今月 / 翌月)** に制限
  - タブラベルから「（今月）」「（来月）」の括弧書きを除去 (`MyRequestsAndShiftTabs`)
- **スコープ (やらない)**:
  - `MyRequestsView` (休み希望) の月送り仕様は**現状維持** (既に MonthStepper 内蔵だが範囲制限なし)
  - admin / manager 側の `ShiftFull` の月送り仕様は触らない (元から制限なしで運用中)
  - 過去 6 ヶ月 / 未来 3 ヶ月など広い範囲のサポート (将来要件)
  - ORIGAMI への適用 (Phase 1 で shift 機能凍結中)

## 2. 影響範囲

| 項目 | 該当箇所 |
|---|---|
| **コンポーネント (修正)** | `components/employee/MyFacilityShiftView.tsx` / `components/employee/MyRequestsAndShiftTabs.tsx` |
| **コンポーネント (props 追加)** | `components/shift/MonthStepper.tsx` (`minMonth` / `maxMonth` を新規 optional props として追加。既存 ShiftFull / MyRequestsView 利用箇所は不指定で従来通り無制限) |
| **DB テーブル** | `shift_assignments` (既存、変更なし)。RLS は migration 160 で「同 facility + publish_status=published」をすでに許可しており月の範囲指定は SELECT のクエリ側 (`.gte('date',...).lte('date',...)`) で行う。**migration 不要** |
| **RLS** | 触らない (migration 160 のままで過去/未来月も自然に取得可能) |
| **API ルート** | なし (クライアント直接 supabase クエリのみ) |
| **定数 / types** | なし |
| **ナビゲーション** | サイドバー変更なし。URL は同じ `/my/requests?tab=facility-shift&month=YYYY-MM` |

## 3. 表出箇所マップ

| 出現場所 | 内容 |
|---|---|
| **サイドバー/ナビ** | 該当なし (タブ内部 UI のみ) |
| **ダッシュボードのカード** | 該当なし |
| **設定画面** | 該当なし |
| **通知/トースト/モーダル** | 該当なし (静的 UI、エラーは load 失敗時の inline メッセージのみ) |
| **ヘッダー/フッター/パンくず** | 該当なし |
| **ロール別表示差** | employee 専用画面 (/my/requests)。manager / admin もアクセス可能だがロール別 UI 差はなし。employee の `facility_id` で取得対象 facility が決まる |
| **モバイル時** | MonthStepper は inline-flex + flex-wrap、施設シフト表は overflow-x-auto。既存どおりモバイル対応 |

## 4. 連動更新ポイント

| トリガー | 連動して触るファイル / 関数 |
|---|---|
| **MyFacilityShiftView 月送り対応** | `components/employee/MyFacilityShiftView.tsx` <br>・`useSearchParams` 追加 <br>・`urlMonth` を `?month=YYYY-MM` から読み (バリデーション) <br>・`year`/`month` を URL 派生に変更 (現状は `new Date()` 固定) <br>・useEffect の依存配列に `monthStr` 追加 (既に入っている) <br>・上部に `<MonthStepper minMonth={...} maxMonth={...} />` を配置 <br>・タイトル行 (`<h2>{year}年{month}月 ...`) は month に応じて自動更新 |
| **MonthStepper 範囲制限対応** | `components/shift/MonthStepper.tsx` <br>・props に `minMonth?: string` / `maxMonth?: string` (`'YYYY-MM'`) を追加 <br>・前月ボタン: `current === minMonth` なら `disabled` 表示 <br>・翌月ボタン: `current === maxMonth` なら `disabled` 表示 <br>・「今月へ」ボタン: 範囲外への遷移ボタンは表示しない条件追加 (今月が範囲内なら通常表示) <br>・既存 ShiftFull / MyRequestsView は props 不指定なので**無制限維持** (後方互換) |
| **タブラベル修正** | `components/employee/MyRequestsAndShiftTabs.tsx` <br>・「休み希望（来月）」→「休み希望」 <br>・「施設のシフト（今月）」→「施設のシフト」 |
| **URL クエリ衝突対策** | URL は両タブで `?tab=...&month=...` 共有。タブ切替時に `month` クエリは保持。タブごとに別 month を保ちたい要件は今回はなし (休み希望は既に未指定時=来月をデフォルト、施設シフトは未指定時=今月をデフォルト) |
| **reference-map.md 更新** | `docs/reference-map.md` の §9 ヘルパー/ライブラリ近辺に `MyFacilityShiftView` を追加。 既存 `MonthStepper.tsx` の備考に「`minMonth/maxMonth` 対応、MyFacilityShiftView で ±1 ヶ月制限に利用」を追記 |
| **error-log.md** | 今回は新規バグ修正ではなく機能拡張なので追記不要 |
| **CLAUDE.md** | スキーマ / 制約変更なし → 触らない |
| **両リポ同期** | deaf-ic と diletto の 3 ファイル (MyFacilityShiftView / MyRequestsAndShiftTabs / MonthStepper) を**同一パッチ**で更新。差分があれば diff -q で事前確認 |

## 5. ロール別権限マトリクス

| ロール | /my/requests?tab=facility-shift アクセス | 月送り | 範囲 |
|---|---|---|---|
| `admin` | 可 (自分の所属 facility のシフトを見る、業務上の用途は少ないが ban しない) | 可 | 前月 / 今月 / 翌月 |
| `manager` | 可 (manager も employee として自身の所属 facility を見る経路) | 可 | 前月 / 今月 / 翌月 |
| `employee` | 可 (主用途) | 可 | 前月 / 今月 / 翌月 |
| 未認証 | 不可 (middleware で /login にリダイレクト) | - | - |

※ RLS (`sa_employee_facility_shifts` / migration 160) で「同 facility + publish_status=published」のみ取得されるため、ロールに関わらず**自分が所属する事業所の公開済みシフトのみ**閲覧可能。これは既存仕様。

## 6. 既存機能との差分・依存

### 既存類似機能
- **MyRequestsView (休み希望)**: 既に MonthStepper を内蔵 (URL `?month=` 制御)、ただし**範囲制限なし**。仕様維持
- **ShiftFull (admin / manager のシフト編集グリッド)**: MonthStepper を内蔵 (URL `?month=` 制御)、**範囲制限なし**。仕様維持
- 本機能 (MyFacilityShiftView) のみ ±1 ヶ月制限を入れる差別化。これは「閲覧専用 + 通常業務に必要な範囲」を狭める設計判断

### 依存先
- `MonthStepper` (本仕様で props 追加するが後方互換)
- `fetchMyFacilityIds` (主所属 + 兼任先 facility 集合取得)
- `isJpHoliday` / `jpHolidayName` (祝日判定)
- `todayStr` (今日のセル強調)
- `shift_assignments` テーブル RLS (migration 160)

### この変更で影響を受ける既存機能
- **MyRequestsView**: MonthStepper の props 拡張のみ。利用箇所は不指定で従来通り → **影響なし**
- **ShiftFull (admin/manager)**: 同上 → **影響なし**
- **MyRequestsAndShiftTabs のタブ切替 URL**: `?tab=facility-shift` クエリは保持。`month` クエリは両タブで共有 (任意指定時のみ尊重) → **既存挙動の意味的変更なし**

## 7. 実装ルール

### 命名規則
- props: `minMonth?: string` / `maxMonth?: string` (kebab 表記の Tailwind と統一しないが TypeScript の camelCase 規約に従う)
- 形式は `'YYYY-MM'` 文字列で MonthStepper の内部表現と一致

### 再利用すべき既存コンポーネント
- `MonthStepper` を必ず使う (独自実装禁止)
- `MyRequestsView` の `useSearchParams` + `targetMonth` パターンをそのまま踏襲

### MyFacilityShiftView の月導出ロジック (擬似コード)
```ts
const searchParams = useSearchParams();
const urlMonth = searchParams.get('month');
const thisMonth = format(new Date(), 'yyyy-MM');
const isValidYM = urlMonth && /^\d{4}-\d{2}$/.test(urlMonth);

// ±1 ヶ月の範囲算出
const prevMonth = shift(thisMonth, -1);
const nextMonth = shift(thisMonth, +1);

// 範囲外 URL は今月にフォールバック (range guard)
const targetMonth = (isValidYM && [prevMonth, thisMonth, nextMonth].includes(urlMonth))
  ? urlMonth
  : thisMonth;
const [year, month] = targetMonth.split('-').map(Number);

// MonthStepper に同じ範囲を渡す
<MonthStepper minMonth={prevMonth} maxMonth={nextMonth} />
```

### design-system トークン
- 既存の `var(--accent)` / `var(--white)` 等を MonthStepper 内で使用済 → そのまま
- 新規スタイル追加なし

### モバイル対応
- `inline-flex flex-wrap` + `overflow-x-auto` で既に対応済 → そのまま

## 8. 完成条件

### 正常系
- [ ] `/my/requests?tab=facility-shift` (month 未指定) → 今月表示
- [ ] `?month=2026-04` (前月) → 4 月表示、前月ボタン disabled、翌月ボタン有効
- [ ] `?month=2026-05` (今月) → 5 月表示、前月/翌月ボタン共に有効、「今月へ」ボタン非表示
- [ ] `?month=2026-06` (翌月) → 6 月表示、前月ボタン有効、翌月ボタン disabled
- [ ] タブ切替時 (休み希望 ↔ 施設のシフト): `month` クエリ保持
- [ ] タブラベルが「休み希望」「施設のシフト」(括弧なし)

### 異常系
- [ ] 不正な `?month=2026-13` → 今月にフォールバック (year guard / month 1-12 範囲チェック)
- [ ] 範囲外 `?month=2026-02` (現在月から 3 ヶ月前) → 今月にフォールバック
- [ ] 範囲外 `?month=2026-08` (現在月から 3 ヶ月先) → 今月にフォールバック
- [ ] `?month=invalid` (フォーマット不正) → 今月にフォールバック
- [ ] 該当月のシフトが未公開 → 「YYYY 年 MM 月の {施設名} のシフトはまだ公開されていません」(既存メッセージ)

### 境界値
- [ ] 月末日 (5/31) クリック後、翌月 (6/1) の境界が表示される
- [ ] うるう年の 2/29 を含む月の表示
- [ ] 月の最終日が今日のとき、その日セルだけ強調 (`bg-brand-blue/10`)

### ローカル確認
- [ ] `npm run dev` で `/my/requests?tab=facility-shift` を開く → 月送り操作 → DB のシフトデータが正しく表示される
- [ ] employee アカウント + 兼任 facility あり → 複数施設のシフトが merged で表示される
- [ ] manager / admin でアクセスしても同じく動作する
- [ ] `npx tsc --noEmit` がクリーン

### 将来対応の分離
- 過去 6 ヶ月 / 未来 3 ヶ月への拡張: props 拡張せず `minMonth/maxMonth` を変えるだけで済む設計にしておく
- カレンダー UI (year jump / 日付 picker): 現状の `MonthStepper` の `showYearJump` props を使えば足りる (今回は未使用)
- 印刷用 PDF 出力: 別仕様で対応 (今回スコープ外)

---

## 実装メモ (実装後に追記)

(未着手)
