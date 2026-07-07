# error-log.md — deaf-ic エラーログ

実装中に発生したエラーと解決方法を記録する学習ログ。
**解決したら作業完了前に必ず記録。同種エラー発生時はまずこのファイルを参照すること。**

---

## 兼任職員の「他施設 勤務」バッジが、全施設が同時にシフトを作ると消える + 兼任が二重フル出勤で生成される

- **発生日**: 2026-07-03（先方要望④のヒアリング中に発覚。実データで ※金さん 7月に パレット27日(ready) と 本部22日(draft) の二重フル出勤を確認）
- **発生箇所**: `components/shift/ShiftGridFull.tsx`（表示条件）+ `lib/logic/generateShift.ts`（生成の空白日ルール）+ `components/shift/ShiftFull.tsx`（他施設 fetch）
- **エラー内容**: 兼任職員が他施設で勤務する日に「○○ 勤務」バッジが出るはずが、**全施設がシフトを生成した後は表示されない**。さらに自動生成が兼任者を非主所属施設でもフル出勤(normal)で埋め、二重アサインを量産
- **原因（構造的真因）**:
  - 表示条件が `segs.length === 0`（本施設にその職員のセルが**1つも無い**とき限定）だった。全施設が同時生成すると兼任者にも本施設に行（off 等）ができるため、条件が常に false になりバッジが消える
  - 生成ロジックが「兼任（主所属≠生成対象施設）」を区別せず、パート/opt-in と違って**空白日を normal で埋めていた**
  - 加えて「他施設勤務」の判定が `assignment_type` ベースで、公休/希望休/有給（時間なし）まで拾い得た
- **解決方法**:
  - 表示条件を `type === 'off'`（自施設が休み/未設定）に変更。出勤系セルは ⚠ 赤で二重アサイン警告
  - 生成: 兼任職員（`s.facility_id && s.facility_id !== facilityId`）の空白日を `off` に（パートと同扱い）。主所属側の生成は不変＝「本部の通常スケジュールはそのまま」
  - 判定を**時間ベース**に統一（他施設 fetch を `.not('start_time','is',null)`、`isAttended` と同哲学）。公休/希望休/有給は他施設勤務に数えない
  - RLS は既存 `sa_manager_cross_facility_select`(131/140) が publish_status 無制限＝draft も可視。`scripts/probe-rls-cross-facility-draft.mjs` で「manager が他施設 draft を RLS 越しに SELECT 可能」を実証
- **再発防止**:
  - 「本施設にセルがあるか(`segs.length`)」ではなく「**時間が入っているか**」を勤務判定の単一基準にする（`isAttended` に揃える）
  - 兼任職員は生成で自動出勤させない（勤務日は人手/右クリックコピペで設定）→ 全施設同時生成でも衝突しない
- **教訓**: マルチ施設で「相手側にデータがあるか」を表示条件にすると、両側が同時に埋まった瞬間に破綻する。判定は「時間の有無」のような**それ自体が意味を持つ属性**で行う
- **追補（2026-07-07）**: 上記修正後も「兼任(所属)を外したのにバッジが残る」報告（金田さん・主パズルのみ、パステル残存1行）。真因は **cross fetch が所属チェックせず全他施設の勤務を拾っていた**こと（所属を外しても過去の `shift_assignments` は消えない）。修正: 各職員の現所属集合（主 `employees.facility_id` ∪ `employee_facilities`）で cross 勤務を絞る（`memberFacilities.has(facility_id)`）。所属を外せば即バッジ消滅。`scripts/probe-membership-filter-after.mjs` で実証。教訓: 「他施設の勤務を出す」は必ず「**今その施設に所属しているか**」とセットで判定する

---

## 休み希望「補足メモ」が保存のたびに指数増殖して同一文が何度も表示される

- **発生日**: 2026-06-17（落合良子さん本部7月で「29日は父の一周忌法要のため」が27回表示）
- **発生箇所**: `components/shift/MyRequestsView.tsx`（保存 L230-240 / 読込 L100-106）+ `components/shift/AdminRequestsView.tsx`（表示 L234-241）
- **エラー内容**: 補足メモが同一フレーズで多数回繰り返し保存・表示される（落合さん=各 request_type 行に同一フレーズ×9）
- **原因（構造的真因）**: メモは「社員×月」で1つなのに、`shift_requests` の **request_type 別の各行に冗長保存**していた。
  - 保存(MyRequestsView): `notes: trimmedNotes` を**全行**に書込
  - 読込(MyRequestsView): `setNotes(allNotes.join(' / '))` で**全行の notes を ' / ' 連結**
  - → 保存のたびに `X` → `X / X / X`（行数分）→ 次回さらに連結 と**指数増殖**。重複排除が無いのが真因
- **解決方法**:
  - 保存: メモは**先頭1行のみ**に保存（`idx === 0 ? trimmedNotes : null`）。単一ソース化
  - 読込: フレーズ単位で重複排除（`split(' / ')` → `Set` → `join`）
  - 表示(AdminRequestsView): 行をまたいでフレーズ重複排除し1回だけ表示
  - データ片付け: `scripts/cleanup-shift-request-notes.mjs` で①行内フレーズ重複圧縮 ②(employee,month)単位で先頭行へ集約・他行 NULL。deaf-ic で 7行圧縮+13行 NULL、フレーズ重複ゼロを確認
- **再発防止**:
  - 「読込=全行結合・保存=全行書込」の循環を構造的に断つ（メモは1行のみ＝仕組みで防止）
  - 表示側もフレーズ重複排除で二重防御
  - diletto は同一コードのため同修正を適用（diletto DB は notes 0件で増殖未発生だが将来防止）
- **教訓**: 「1対多テーブルに、本来1つの値（メモ）を全子行へ冗長コピー」+「読込で全子行を連結」は増殖バグの定番。1つの値は単一行に持たせる

---

## 動画/PDF アップロードが「The object exceeded the maximum allowed size」で 50MB 超だけ失敗

- **発生日**: 2026-06-12（ユーザー指摘「PDF/動画のアップロードでエラーが何か所か出てる」）
- **発生箇所**: `components/admin/BlockEditor.tsx`（Storage 直アップロード）/ `scripts/migrate-drive-to-storage.mjs`（Drive→Storage 移行）
- **フェーズ**: 本番運用中（マニュアル/研修の動画・PDF 投稿）
- **エラー内容**: `documents`/`videos` バケットへ 50MB 超の PDF・動画をアップロードすると `The object exceeded the maximum allowed size`。Drive→Storage 移行でも 50MB 超の 11 件が同エラーで失敗（`docs/content-media-migration-failures.json`）
- **原因（真因）**: migration 212/213 でバケット個別の `file_size_limit` を 200MB/500MB に設定済み（実 DB で確認）だが、**Supabase プロジェクト全体の "Storage upload file size limit"（Settings → Storage）が既定の 50MB のまま**で、これがバケット個別上限より優先される。500MB の `videos` バケットへ service_role（RLS 無関係）で 60MB を上げても弾かれることを実機確認（`scripts/probe-effective-upload-limit.mjs`）。実格納オブジェクトの最大が videos 46.9MB / documents 10.4MB で 50MB 超がゼロなのも傍証（`scripts/probe-media-buckets.mjs`）
- **解決方法**: 当面インフラを触らず、動画/PDF を Storage アップロードから **URL 入力（YouTube / Google Drive）に一本化**（BlockEditor 改修・2026-06-12）。レンダラ（`BlockRenderer`）は元から URL 描画対応のため表示は無改修。**根本対処（グローバル上限の引き上げ）は未実施** — 実施するなら Pro 前提で Dashboard Settings → Storage か Management API で 500MB 以上に変更し移行スクリプトを再実行
- **再発防止**:
  1. バケットの `file_size_limit` を上げても、プロジェクト全体の Storage グローバル上限がボトルネックになる。**migration SQL では直せない設定**であることを忘れない（DB オブジェクトではないので CLAUDE.md §16 の Dashboard 禁止対象外）
  2. 「migration 適用済み＝意図どおり機能する」と思い込まない。バケット設定は `probe-media-buckets.mjs`、実効上限は `probe-effective-upload-limit.mjs` で実機確認する
  3. UI の上限表示（旧「最大 500MB」）と実効上限（50MB）が乖離するとユーザーが混乱する。上限を変えたら表示も合わせる

---

## /my/requests?tab=facility-shift で employee が自分しか見えない → employees RLS「自分のみ」+ 既存 RPC が employee を弾く

- **発生日**: 2026-06-08（ユーザー指摘「社員だと自分だけしか見れない」）
- **発生箇所**: `components/employee/MyFacilityShiftView.tsx` の `.from('employees').select(...).in('facility_id', facIds)`
- **フェーズ**: 本番運用中の権限バグ
- **エラー内容**: /my/requests?tab=facility-shift で employee がアクセスすると、同 facility の他社員のシフトが見えず、自分の行だけが表示される（shift_assignments 自体は他人分も RLS で許可されているのに表に並ばない）
- **原因（真因）**: 2 段階の制限が重なっていた
  1. `employees` の RLS は `migration 000` の「employee can read self」(`auth_user_id = auth.uid()`) のみで、employee が同テナント他社員を SELECT する経路が存在しない
  2. 補完用の SECURITY DEFINER RPC `get_facility_members`(migration 155) は冒頭で `if v_role not in ('admin','manager','shift_manager') then return; end if;` と書かれており、**employee 役割を明示的に弾く設計**になっていた（当時は manager/shift_manager の RLS 再 SELECT 弾き対策として作られたため）
  - 結果: shift_assignments は employee 視点でも他社員分まで返るのに（160/216 で許可済み）、employees 行は自分しか返らず表が 1 行しか描画されない
- **解決方法**: migration 217 で新 SECURITY DEFINER RPC `get_my_facility_shift_view_employees(p_facility_ids uuid[])` を追加。全ロール (admin/manager/shift_manager/employee) 対応で、role ごとに見える facility 集合と引数 p_facility_ids の積集合を求め、その facility に居る active 社員（主+兼任）の**最小列**のみ返す（id / 氏名 / facility_id / shift_display_order / 既定開始終了時刻）。住所・電話・birth_date・銀行・保険番号などは含まない（CLAUDE.md §9・§10 のろう者納品仕様＋既存「壁掲示相当の情報」運用に沿う）。`lib/multi-facility.ts` に `fetchFacilityShiftViewEmployees` ヘルパー、`MyFacilityShiftView.tsx` の employees fetch をこの RPC 経由に置換。本番 DB 適用時に🎨パレット employee の視点で 1件→16件（主14+兼任2）に増えることを確認
- **再発防止**:
  1. SECURITY DEFINER RPC で role を弾くときは「現時点で要らない role を入れない」のではなく「**将来要りそうなら個別 if 分岐で残す**」。今回 `get_facility_members` の冒頭弾きが employee 機能の追加で初めて顕在化した（社員シフト閲覧機能は当時無かった）
  2. 「画面で見える＝RLS で取れている」と思い込まない。複数テーブルを跨ぐ画面は **どのテーブルの RLS で削られて見えなくなっているか**を切り分ける（今回も shift_assignments は見えていて employees で削られていた）。employee 機能を増やすときは employees / facilities / 関連 RLS の 3 つを必ず touch チェックする
  3. 「壁掲示と同等の情報範囲」を返す RPC を別途用意することで、employees の RLS を素のまま温存しつつ機能要件を満たせる（住所・銀行口座は今でも employee からは見えない）

---

## 業務日報の施設名・日付タイトルが印刷時に消える → globals.css が `header` 要素を一律非表示

- **発生日**: 2026-06-08（ユーザー指摘「業務日報が施設名と日付が出ません」+ スクショ：印刷プレビュー先頭が利用者氏名テーブルから始まっている）
- **発生箇所**: `components/shift/DailyReportFull.tsx`（`<header className="report-title">`）+ `app/globals.css`（@media print の `header { display: none !important; }`）
- **フェーズ**: 本番運用中の挙動修正（業務日報出力）
- **エラー内容**: 業務日報の印刷プレビューに施設名と日付タイトルが表示されない。1日1ページのはずがコンテンツが溢れて 2 ページに分割され印刷枚数が倍増
- **原因（真因）**:
  1. **タイトル消失**: `globals.css:272-276` が @media print で `aside, header, .print-hide` を一律 `display:none`。レイアウトのトップバー（admin/manager layout の `<header>`）を消す目的だが、セレクタが広すぎてコンテンツ側で意味的に使われた `<header className="report-title">` まで巻き込んでいた
  2. **複数ページ化**: `.report-page` が `min-height: 281mm`（max ではない）で、`activity-box` の `flex: 1` + 長い `daily_report_template` で 281mm を超えるとそのまま次ページに溢れる。`page-break-inside: avoid` も無かった
- **解決方法**:
  1. DailyReportFull の `<header className="report-title">` を `<div>` に変更（セマンティクスより印刷可視性優先、コメントで globals.css の制約を明示）
  2. @media print に防御として `.report-page .report-title { display: block !important; }` を追加（将来 globals.css がさらに広くなっても守れる）
  3. 印刷時のみ `.report-page` を `height: 281mm; overflow: hidden; page-break-inside: avoid` に変更し 1 日 1 ページを厳格化（はみ出しは activity-box 内でクリップ）
  4. テーブル行高 22px→19px、`activity-box` min-height 60mm→36mm、タイトル 28px→24px に詰めて余裕を作る
  5. 利用者氏名 30% → 34%、備考 10% → 6% に再配分（ユーザー承認済み）
- **再発防止**:
  1. `globals.css` の `@media print` の `header { display: none }` は将来も生きる地雷。コンテンツ側で印刷したい見出しは `<header>` ではなく `<div>` か `<h1>` 等にする。または globals.css を `body > header` / `.app-topbar` 等で限定セレクタ化（今回は影響範囲確認の手間を避けて DailyReportFull 側を直したが、いずれグローバル側も狭めるべき）
  2. 印刷を 1 ページに収めたいセクションは `min-height` ではなく `height: <A4 page height>; overflow: hidden;` を必ずペアで指定する。min-height だけだと内容に応じて伸び、複数ページに分割される
  3. 「印刷時の見た目」は @media print + 実機印刷プレビューで確認する。スクリーン表示だけで判定しない（globals.css の print 専用ルールが効くのは print 時のみ）
- **横展開**: 他コンポーネントで `<header>` を印刷対象セクションに使っている箇所は `grep '<header'` で確認済み（DailyReportFull のみ）。billing/daily/transport 等は OK

---

## 保存済み利用料金表が利用表(schedule_entries)の事後変更に追従しない → 出席日数をスナップショット参照していた

- **発生日**: 2026-06-08（ユーザー指摘「保存されていても利用表の回数が正」）
- **発生箇所**: `components/shift/BillingFull.tsx` `fetchAll()` の row 構築（`attendanceDays` の出どころ分岐）
- **フェーズ**: 本番運用中の挙動修正（Phase 66 利用料金表）
- **エラー内容**: 月締めで一度「保存」した月は、その後 利用表 (`schedule_entries`) に出席（時間）を追加・削除しても、料金表の出席日数・おやつ代・請求額が古いまま更新されない。実 DB の 2026-05 に 3 件のズレ（🖌️パステル「グエン」保存=0→実=13 で請求 ¥650 不足、🎨パレット 溝江/中根 各 +¥150、合計 +¥950）
- **原因（真因）**: BillingFull が出席日数を `existing ? existing.attendance_days : ライブ値` と分岐し、保存済み（`billing_summaries` 行が存在する）月では保存時スナップショット `attendance_days` を表示に使っていた。利用表を直しても `billing_summaries` を無効化/再計算する連動が無く（`ScheduleFull` 側に billing 参照ゼロ）、出席日数列は表示専用で手動更新もできないため、保存後はズレを直す手段が UI に無かった
- **解決方法**: 出席日数を常に利用表のライブカウント（`presentDaysByChildId` = `isAttended` で集計）を正とするよう変更。`attendanceDays` を無条件にライブ値へ。おやつ代・請求額は `r.attendanceDays` 派生なので自動追従。copay（手動上書き値）/ イベント参加 / 受取日は従来どおり保存値を保持。保存済みでライブ値とズレる月は `dirty: !existing || existing.attendance_days !== attendanceDays` で「保存」を有効化し `billing_summaries` も最新化可能に。`billing_summaries` を読むのは BillingFull のみ（grep 済み）なので表示ライブ化で恒久的に「利用表＝正」が成立し、SQL/DBトリガーは不要。既存ズレ 3 件もページを開くだけで正値表示
- **再発防止**:
  1. 「保存＝スナップショット」設計を入れるなら、ソース（ここでは利用表）が後から変わる列はどれか・誰がそのテーブルを読むかを先に確定する。読み手が 1 画面だけなら、スナップショット保存より表示時ライブ計算の方が連動バグを生まない
  2. 集計値を別テーブルにコピー保存したら「元データ変更時の再計算/無効化トリガー」をセットで設計する（無ければスナップショットは必ず腐る）
  3. 出席判定は `lib/logic/attendance.ts` の `isAttended` に一元化済み。表示・保存・印刷で同じ関数を通す（料金表で出席判定をコピペし直さない）

---

## ルート/ページを削除すると `.next/types` `.next/dev/types` の stale validator で `tsc`/`build` が落ちる

- **発生日**: 2026-06-04（`app/api/shifts/import-pdf/route.ts` 撤去後）
- **発生箇所**: `npx tsc --noEmit` / `npm run build` の型チェック。`.next/dev/types/validator.ts` / `.next/types/validator.ts`
- **フェーズ**: 孤児コード撤去
- **エラー内容**: `error TS2307: Cannot find module '../../../app/api/shifts/import-pdf/route.js'`。ソースからは全参照を消したのに型チェックだけ失敗。`next build` は「✓ Compiled successfully」の後に「Failed to type check」で落ちる
- **原因（真因）**: `tsconfig.json` の `include` が `.next/types/**/*.ts` と **`.next/dev/types/**/*.ts` の両方**を含む。Next.js が各ルートを列挙する `validator.ts` を生成するが、これは**削除しても自動では再生成されない**。特に `.next/dev/types/` は `next dev` 由来で、dev サーバ停止中は誰も更新しないため**削除済みルートを参照したまま残る**。`next build` は `.next/types/` を再生成するが `.next/dev/types/` には手を付けないため、stale な dev validator で型チェックが落ちる
- **解決方法**: dev サーバが停止中であることを確認（`Get-NetTCPConnection -LocalPort 6001`）した上で `Remove-Item .next/dev -Recurse -Force` → `npm run build` 再実行で解消。dev サーバ稼働中なら保存トリガで再生成される
- **再発防止**:
  1. **ルート/ページ/route handler を削除したら、`.next/dev`（と必要なら `.next/types`）の stale validator を消してから tsc/build を回す**
  2. 「Compiled successfully なのに Failed to type check」かつ TS2307 が `.next/.../validator.ts` 由来なら、ソースではなく生成キャッシュを疑う（ソース grep で参照ゼロを先に確認）
  3. dev サーバ稼働中の削除なら、保存し直し（再生成トリガ）で直ることが多い

---

## 利用表のコピペで前回分（過去の利用）が残り当月に古いデータが混在する → upsert のみで削除が未実装

- **発生日**: 2026-06-04（ユーザー指摘「コピペしても過去の分が残ってめちゃくちゃ迷惑」。実 DB で 🧩パズル 2026-05 に複数回ペースト分が累積していた）
- **発生箇所**: `components/shift/ScheduleFull.tsx` `handleBulkImport` / `components/shift/ExcelPasteModal.tsx`（差分プレビュー）
- **フェーズ**: 本番運用中の挙動変更
- **エラー内容**: 利用表（`schedule_entries`）をコピペ取り込みしても、前回ペーストにあって今回に無い児童×日付の利用が消えず残る。さらにモーダルは「🔴 削除 N」と差分表示するのに**実際には1件も削除していなかった**（表示と挙動の乖離）
- **原因（真因）**: `handleBulkImport` が `upsert(onConflict: tenant_id,facility_id,child_id,date)` のみで、貼り付けに含まれない既存行を削除する処理が無かった（＝差分マージ）。モーダルの `removeEntries`/`diffCounts.removed` は表示専用で、`onConfirm(parsed)` は parsed しか親に渡さないため削除に結びついていなかった
- **解決方法**: `handleBulkImport` を完全上書き化。① 貼り付け分を upsert（同 child_id+date は **in-place 更新で id 保持**＝送迎割当 FK 無傷）→ ② 当月 `rawEntries` のうち貼付に無い行を `.in('id', chunk)` 100 件刻みで DELETE（`transport_assignments.schedule_entry_id` の `ON DELETE CASCADE` で送迎も連動削除）。児童名が全不一致のときは誤爆防止で削除せず中断。モーダルの差分4分類は廃止し「削除 N 件」警告のみに。PDF 取込 UI は廃止しコピペ（ボタン名「ペースト」）に一本化。即時の累積分は `scripts/cleanup-schedule-month.mjs` で 🧩パズル 2026-05 をバックアップ取得後に全削除
- **再発防止**:
  1. **「差分を画面表示する」だけで「実際に適用する」処理が無い UI を作らない**（表示と DB 反映の乖離はユーザーに「壊れている」と映る）
  2. 上書き系の取り込みは「全削除→INSERT」ではなく「upsert（id 保持）＋差集合 DELETE」にする。FK が `ON DELETE CASCADE` の子（送迎）を不意に巻き込まないため、再登録分は必ず in-place 更新で id を維持する
  3. `rawEntries` は当月分（1 施設 < 1000 行）前提。複数施設横断や年跨ぎで使う場合は `fetchAllRows()` ページングに切替（[1000 行上限の同日別エントリ参照](#兼任職員の施設シフト表が途中までしか表示されない--postgrest-の暗黙-max-rows1000-打ち切り)）
- **横展開**: diletto-new-staffbase / origami も同系の利用表コピペがあれば同根。要確認

---

## 兼任職員の施設シフト表が「途中まで」しか表示されない → PostgREST の暗黙 max-rows(1000) 打ち切り

- **発生日**: 2026-06-01（ユーザー指摘「社員画面でパレットのシフトが途中までしか表示されない」）
- **発生箇所**: `components/employee/MyFacilityShiftView.tsx`（施設シフト表の shift_assignments 取得）。同型の取得が `app/(employee)/layout.tsx`（nav バッジ）/ `app/(employee)/my/dashboard/page.tsx`（シフトカード）にもあった
- **フェーズ**: 本番運用中バグ修正
- **エラー内容**: 兼任（複数施設所属）の職員が施設のシフトタブを開くと、表の右側（後半の日付）が多くの職員で空（—）になり「途中まで」に見える。エラーは一切出ない（サイレント）
- **原因（真因 — ユーザーの仮説が的中）**: `MyFacilityShiftView` は `.in('facility_id', facIds)`（主所属 + 兼任先の**複数施設**）で shift_assignments を取得するが、`.limit()` も `.range()` も付けていなかった。パレット(318) + パステル(311) + パズル(423) の 6 月分 = **1052 行 > PostgREST のデフォルト max-rows(1000)** に当たり、**1000 行で黙って打ち切られていた**。データ・RLS は正常（service role / employee の JWT 注入いずれでも 318 件全日取得可）で、employees も 40 名取得できるため「行は出るのにシフトセルが 52 行ぶん欠落」して途中までに見えた。単体所属（パレットのみ 318 行）の職員は 1000 以下なので無症状だった
- **解決方法**: `lib/multi-facility.ts` に `fetchAllRows()` ページングヘルパーを新設（`.range(from, from+999)` で 1000 件ずつ全件ループ取得）。`MyFacilityShiftView` のシフト取得 + layout / dashboard のシフトバッジ取得を `fetchAllRows` 経由に置換。実 DB で「単発=1000 打ち切り → fetchAllRows=1052 全件」を実証
- **再発防止**:
  1. PostgREST の暗黙上限に依存しない `fetchAllRows()` を共通ヘルパー化（複数施設 × 大量行を引く箇所はこれを使う）
  2. 教訓「`.in('facility_id', 複数)` で行数が増えうるクエリは `.limit()`/`.range()` 無しにしない。数千行になりうるテーブル（shift_assignments / schedule_entries / transport_assignments）は特に注意」
  3. 「サイレントに途中まで」系の症状は PostgREST max-rows をまず疑い、`scripts/probe-1000-cap.mjs`（Prefer: count=exact で content-range の総数 vs 返却数を比較）で確定する
- **横展開**: diletto-new-staffbase も同一コードのため同症状。同じ `fetchAllRows` 修正を適用
- **検証**: 両 repo tsc 0 エラー / 変更ファイル eslint 新規エラーなし。実 DB ページング取得で 1052 件（パレット 318 全件含む）を確認

---

## GitHub Actions `notification-cron` が毎回失敗してエラーメールが届き続ける → pg_cron 移行後の残骸ファイル

- **発生日**: 2026-05-31（ユーザー指摘）
- **発生箇所**: `.github/workflows/notification-cron.yml`
- **フェーズ**: 運用中
- **エラー内容**: GitHub Actions の `notification-cron` ワークフローが 30 分毎に「All jobs have failed」で失敗し、`deafzimukyoku-ic/deaf-ic-staffbase` の workflow run 失敗メールが届き続ける。
- **原因（真因）**: migration 181 で通知ディスパッチを GitHub Actions cron → Supabase pg_cron（`dispatch_notification_queue`、`*/10` で稼働中・成功を実 DB で確認）に移行したが、`.github/workflows/notification-cron.yml` を削除し忘れて残置。GH Secrets（CRON_TARGET_URL / CRON_SECRET）が Vault 移行で未設定になり、ワークフロー先頭の secret チェックで `exit 1`（または 401）し毎回失敗していた。実害なし（pg_cron が正規配信、二重ではない）だが失敗メールが鳴り続ける。
- **解決方法**: `.github/workflows/notification-cron.yml` を `git rm` で削除。pg_cron が唯一の配信経路として稼働継続。`scripts/probe-pgcron.mjs` で job active + 直近実行 succeeded を確認済。
- **再発防止**: 配信経路を移行するときは旧経路（GHA workflow / Vercel cron 等）のファイルも同じ PR で削除する。pg_cron 稼働は `scripts/probe-pgcron.mjs` で確認できる。
- **横展開**: diletto は `.github/workflows` 自体が存在せず該当なし。

---

## シフトを公開しても職員に通知メール/PWAが届かない → enqueue が first_scheduled_at NOT NULL 違反で全失敗（握り潰し）

- **発生日**: 2026-05-31
- **発生箇所**: `app/api/shifts/transition/route.ts`（通知 enqueue INSERT）。影響は `app/api/cron/send-notifications/route.ts` 経由の全シフト通知（メール・PWA 両方）
- **フェーズ**: 本番運用中バグ修正（パレット事業所「6月シフトを公開したが職員が見れない」の調査起点）
- **エラー内容**: `null value in column "first_scheduled_at" of relation "notification_queue" violates not-null constraint`（本番 DB の dry-run INSERT で再現）。UI 上は公開が成功するため無症状に見え、`notification_queue` に shift_ready/shift_publish が累計 0 件（deaf-ic 108 件中 0 / diletto 33 件中 0）。
- **原因（真因 — 場所ではなく経路）**: migration 180 で `notification_queue.first_scheduled_at` を NOT NULL 化したが、enqueue 経路は 2 つあり、`app/api/notifications/enqueue`（コンテンツ系）は追従して値を設定、`app/api/shifts/transition`（シフト系）は設定漏れ。後者の INSERT が NOT NULL 違反で必ず失敗し、しかも `catch` がログのみで握り潰していたため遷移は成功扱い →「公開できるのに通知ゼロ」が 180 適用（2026-05-18）以降ずっと継続。なお「職員が見れない」の主訴は RLS ではなく（実 employee の JWT で 318 件 SELECT 可と再現確認済）、職員向け画面（施設シフトタブ / ダッシュボードカード）が常に「今月」固定で、翌月公開・今月未公開のため「未公開」と表示していた別問題（同時修正）。
- **解決方法**:
  1. `app/api/shifts/transition` の enqueue INSERT に `first_scheduled_at` を明示設定。`catch` の握り潰しをやめ `notification_warning` をレスポンスで返し `ShiftFull` が alert 表示。
  2. migration 215（deaf-ic）/ 200（diletto）で `first_scheduled_at` に `DEFAULT now()` を付与（どの enqueue 経路が omit しても落ちない構造ガード）。
  3. 公開時に職員へも通知（`processShiftRow` の shift_publish で admin に加え該当施設職員へ別テンプレ `buildShiftPublishedEmployeeEmail` + Push を配信）。
  4. 施設シフトタブ / ダッシュボードシフトカードを「公開済み最新月（通常は翌月）」基準に変更し「未公開」誤表示を解消。
- **再発防止**:
  1. DB 側 `DEFAULT now()`（構造ガード）＋ アプリ側明示設定の 2 段構え。
  2. 通知 enqueue 失敗を握り潰さず UI に出す（無症状化の防止）。
  3. 教訓「migration で既存列に NOT NULL を足すときは、全 INSERT 経路を grep して追従漏れを確認する」。
- **横展開**: diletto-new-staffbase も同一コード・同一制約で同症状。migration 200 ＋ 同一コード修正で同時是正。
- **検証**: 両 repo の apply script の before/after dry-run で BEFORE=NOT NULL 違反で失敗 → AFTER=成功 を実証。
- **追記（2026-05-31 同日の自己回帰）**: ① の smartDefault 実装で公開済み月クエリの上限を `` `${nextMonth}-31` `` とハードコードしたため、30/29/28 日月（例 2026-06）で `date/time field value out of range: "2026-06-31"` のクエリエラー → 結果 0 件 → smartDefault 不発 → 今月にフォールバックする不具合をローカル確認で検出。**月末を `-31` でハードコードしない**。排他境界 `.lt('date', 翌月1日)` に修正（`MyFacilityShiftView.tsx` 両 repo）。`scripts/probe-smartdefault-date.mjs` で BEFORE=エラー0件 / AFTER=318件・公開月=2026-06 を実証。

---

## Drive 動画が読込 10 秒以上で離脱増 → proxy 経路が真因 (2026-05-19 の対症療法を構造修正)

- **発生日**: 2026-05-26
- **発生箇所**: `components/admin/BlockRenderer.tsx` (Drive 動画分岐) + `app/api/drive-video/[fileId]/route.ts`
- **フェーズ**: 本番運用中バグ修正
- **エラー内容**: 4 機能 (遵守事項 / 研修 / お知らせ / 業務マニュアル) に貼った Drive 動画が再生開始まで 10 秒以上かかり離脱者が多発。
- **原因 (真因 — 場所ではなく経路)**: Drive 動画を `<video src="/api/drive-video/{id}">` で配信していた。Vercel Function 経由のため (1) cold start (2) Drive への redirect chain (3) Range request も毎回 3 ホップ + `Cache-Control: private` で Edge にも乗らない (4) 同ページ複数動画が `preload="metadata"` で並列発火し Hobby Function の 10s timeout 近くまで詰まる、が重なった。さらに Vercel Hobby の **Fast Origin Transfer 10 GB 枠**を直撃して逼迫の主因にもなっていた。下記 2026-05-19 エントリで「Drive `/preview` iframe のモバイル UI 不具合を `<video>`+自前 proxy で塞いだ」判断が、プラン制約に抵触する構造的負債として残っていた。
- **解決方法**: Drive 動画分岐を「Drive を新規タブで開くサムネカード (▶ ボタン)」に置換。`<video>` 要素と `googleDriveVideoUrl()` ヘルパを削除し、`app/api/drive-video/` ディレクトリごと削除。再生は Drive 側 player (CDN 直) で行うため Vercel Function は完全に経由しない。モバイル UI 不具合 (2026-05-19) は別タブ遷移で Drive アプリ / Drive web 側に責任委譲する形で永続的に解決。
- **再発防止**:
  1. `docs/constraints.md` §1 を新設し「動画は Vercel Function を経由させない」を明文化。次に同種の判断が必要になったとき constraints.md を読めば気付ける構造ガードにした。
  2. `/api/drive-video` ディレクトリを残骸も残さず完全削除。grep で `drive-video` がヒットしないことで「やっていい例」として再導入されることを防ぐ。
  3. `<video src="/api/...">` のような Function 経由配信パターンは PR レビュー時にこの error-log を参照。
- **関連 case**: 同じファイル (BlockRenderer.tsx) の同じ分岐を 2026-05-19 → 2026-05-26 で 2 回直している。「症状の場所」(モバイルで見切れ → `<video>` 化、再生が遅い → ???) で対処するとループする。**真因は Drive 動画を deaf-ic 側で配信していること自体**で、Drive 側 player へ責任委譲するのが正解だった。

---

## 「manager 投稿の push 通知が届かない」報告 → 真因はバグでなく push v2 の集約設計仕様 (3 リポ共通教訓)

- **発生日**: 2026-05-25 (diletto で報告、deaf-ic / ORIGAMI も同じ push v2 設計のため共通教訓として記録)
- **発生箇所**: push v2 仕様 (`lib/notifications/queue.ts` / `app/api/notifications/enqueue/route.ts` / `app/api/cron/send-notifications/route.ts`)
- **エラー内容**: 「manager 投稿の push 通知が来ない」報告。iPhone Safari で確認していた。
- **真因**: push v2 は次の設計仕様により、報告時点では送信時刻がまだ来ていなかった (バグではない):
  1. 投稿時 enqueue で `scheduled_at = now + 2h` (`DELAY_HOURS=2`)
  2. quiet hours (JST 23:00-07:00) に該当すれば翌朝 07:00 JST に push back
  3. 同テナントの他の未送信行も新 `scheduled_at` に揃える (ローリングウィンドウ集約)
  4. `MAX_DELAY_HOURS=6` で最古 first_scheduled_at + 6h 後には強制送信
  5. cron `dispatch_notification_queue` (`*/10 * * * *`) は dispatcher 側でも quiet 帯スキップ + scheduled_at <= now() を batch=50 処理
- **解決方法**: コード変更なし。「**バグでなく仕様**」と確認。
- **再発防止**:
  - 「届かない」報告を受けたら **まず実 DB の `notification_queue` を確認**
  - `scheduled_at` が未来 / `sent_at = null` なら**仕様通りの送信待ち**、ユーザーに「JST 07:00 に届く」と説明
  - `scheduled_at` 過去 + `sent_at = null` が続くなら本物のバグ → 別途調査
  - `sent_at` 記録あり + ユーザーに届いていない場合は subscription / APN / VAPID 問題 → `push_subscriptions` 確認
  - diletto に `scripts/probe-push-notification-flow.mjs` 雛形あり、deaf-ic / ORIGAMI でも流用可能
- **同種報告時の SQL クイックチェック**:
  ```sql
  SELECT count(*) FROM public.push_subscriptions WHERE employee_id = '<id>';
  SELECT id, content_type, scheduled_at, sent_at, cancelled_at, first_scheduled_at
    FROM public.notification_queue ORDER BY created_at DESC LIMIT 20;
  SELECT jobname, status, return_message, start_time
    FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
  ```

---

## 記録フォーマット

```
---
## [エラー名・現象の一言説明]

- **発生日**: YYYY-MM-DD
- **発生箇所**: ファイルパス・関数名・行番号
- **フェーズ**: Phase N
- **エラー内容**: 実際のエラーメッセージをそのまま
- **原因**: なぜ発生したか
- **解決方法**: 何をしたら直ったか（コードスニペット含む）
- **再発防止**: 同じエラーを起こさないための注意点
---
```

---

## BlockEditor / mgr-manuals: 画像アップロードが「new row violates row-level security policy」で全件失敗

- **発生日**: 2026-05-25
- **発生箇所**:
  - `components/admin/BlockEditor.tsx` の画像アップロード経路
  - `app/(manager)/mgr/manuals/page.tsx` の PDF / 画像アップロード経路
  - 共通 utility: `lib/upload-helpers.ts` の `buildStoragePath` (`<prefix>/<tenant_id>/<file>` 形式)
  - 該当 RLS: `storage.objects` の `documents` バケット policy
- **エラー内容**:
  - クライアント側 UI: 「画像アップロードに失敗しました」
  - Supabase 実エラー: `new row violates row-level security policy for table "objects"` (status 403)
- **原因 (真因)**:
  - `migration 118` が「authenticated 全員 manage 可」の policy を定義していたが、これは**本番 DB に適用されていなかった**
  - 本番 DB には別途 Supabase Dashboard で手動設定された **厳格 policy** が居座っていた:
    - `"documents: admin can manage"` [ALL] — `role='admin'` 限定 + `folder[1]=tenant_id` 期待
    - `"documents: tenant members can read"` [SELECT] — `folder[1]=tenant_id` 期待
  - しかしクライアントの `buildStoragePath` は `<prefix>/<tenant_id>/<file>` 形式 (例 `manuals/<uuid>/123_xyz.jpg`) を生成するため、`folder[1]` は常に prefix (`manuals` / `announcements` / ...) になり `tenant_id` と**永続的に不一致**。さらに manager は `role` チェックで弾かれる
  - 結果として **本番 DB では BlockEditor 経由の画像アップロードが過去一度も成功していなかった** (`storage.objects` の時系列を全件追って 0 件であることを確認済)
  - 過去アップ済の 9 件は全て API route (service role) 経由かつ `<tenant_id>/<file>.pdf` 形式 (folder[1]=tenant_id が一致) で、これは RLS をすり抜けて動いていた
  - 「以前はできていた」というユーザー記憶は、API route 経由の PDF 雛形アップロードと混同していた
- **解決方法**:
  - `migration 207_storage_documents_rls_fix.sql` で policy を path 形式と manager 許可に合わせて再定義:
    - 読み (`documents: tenant members can read` SELECT): `folder[1]=tenant_id` または `folder[2]=tenant_id` のどちらかに一致すれば OK (新形式 + 旧形式両対応)
    - 書き (`documents: admin or manager can manage` ALL): 上記 path 条件 + `role IN ('admin','manager')`
  - audience (facility) チェックは本体テーブル (`announcements` / `manuals` / 他) の RLS に任せて二重チェックは外す
  - クライアント側 (`buildStoragePath` / `BlockEditor` / `mgr/manuals/page.tsx`) は **一切変更しない**
  - 本番 DB に適用済 + admin/manager で実 upload が通ることをユーザーが検証済
- **再発防止**:
  - **migration ファイルが書かれている = 本番 DB に適用済、とは限らない**。`supabase_migrations.schema_migrations` がないプロジェクトでは適用履歴が追跡できない。今後は `docs/migration-applied.md` に手動で記録する
  - **Supabase Dashboard での policy / RLS / function 直接編集を禁止**。Dashboard で編集すると migration ファイルとの整合性が崩れ、本件のような「ファイルでは fix 済なのに実 DB は別物」事故が起きる
  - RLS 系を変更する**前後で必ず** `scripts/snapshot-storage-policies.mjs` を実行し、`docs/storage-policy-snapshot.json` の diff を commit に同梱する
  - ユーザーの「以前できていた」記憶を主観のまま信じない。`storage.objects` / 投稿テーブルの created_at を**実 DB に問い合わせて事実確認**する (`scripts/probe-*.mjs` 系)
- **影響範囲確認 (本対応で復活する経路)**:
  - admin/manager による画像 (お知らせ / 遵守事項 / 研修 / 業務マニュアル) アップロード
  - `mgr/manuals/page.tsx` の PDF / 画像添付
  - 既存 `<tenant_id>/<file>.pdf` 形式 (API route 経由 PDF テンプレート 9 件) も引き続き読める (旧 path も継続対応のため)
  - employee は read のみ可 (もともと write 不要)

---

## §0 BlockEditor: 日本語ファイル名で画像アップロード失敗 (Supabase Storage "Invalid key")

- **発生日**: 2026-05-23
- **発生箇所**:
  - `lib/upload-helpers.ts` (`sanitizeFilename`)
  - 結果として `components/admin/BlockEditor.tsx` の画像アップロード + マニュアル PDF アップロードが影響
- **エラー内容**:
  - UI: 「画像アップロードに失敗しました」(汎用 toast)
  - 実体: Supabase Storage が object name に非 ASCII (日本語・絵文字・全角記号) を含むキーを `Invalid key` で拒否
  - 旧 BlockEditor 実装が `error.message` を捨てていたため真因が見えなかった (= エラー握りつぶし)
- **原因**:
  - `sanitizeFilename` のヘッダコメントが「Supabase Storage は Unicode パスを許可する」と **誤った前提** を宣言していて、実装も非 ASCII をそのまま残していた
  - 一方 Supabase Storage の現実の制約は ASCII セーフ (`[a-zA-Z0-9._-/]`) のみ。Unicode object key は `400 Invalid key` で拒否
  - ファイル名が完全英数字のときだけ動いていたため気付かれず本番運用に乗っていた
- **解決方法**:
  - `sanitizeFilename` を ASCII セーフ文字のみ残す仕様に変更 (`a-zA-Z0-9._-`、それ以外は `_` 置換)
  - 拡張子は分離してから sanitize し、base が完全に非 ASCII で潰れた場合は `'file'` フォールバック (例: `あいう.png` → `file.png`)
  - 一意性は呼び出し元 `buildStoragePath` の `${timestamp}_${random}_` 前置で保証されるので、人間可読性は捨てて配信成功を取る
  - `BlockEditor.handleImageUpload` の `error` を握り潰さず `toast.error` の description に `error.message` を出すよう改善 + `console.error` ログ追加
- **再発防止**:
  - `sanitizeFilename` のコメントを「Unicode 許可」→「ASCII セーフのみ」に書き換え + 過去の本番事故を明記
  - 真因特定が遅れた原因 = エラー握り潰し。新規 Supabase Storage / 外部 API 呼び出しでは `error.message` を必ずユーザーに見せる (UX 上 description 行に出す) ことを規約化
  - `Array.from(s).map(...)` でサロゲートペア (絵文字) も安全に処理
- **動作確認用 (sanitizeFilename 入出力)**:
  - `"あいうえお.png"` → `"file.png"`
  - `"画像 (1).png"` → `"1.png"`
  - `"hello world.jpg"` → `"hello_world.jpg"`
  - `"社内資料_最新版.pdf"` → `"file.pdf"`
  - `"😀.png"` → `"file.png"`
  - `"a/b.png"` → `"a_b.png"` (path traversal 防止)
  - `"foo.png"` → `"foo.png"` (英数はそのまま)
  - `"file.PNG"` → `"file.PNG"` (大文字保持)
- **副次的に直る経路**: `app/(manager)/mgr/manuals/page.tsx` の PDF アップロードも `buildStoragePath` を経由しているので、`sanitizeFilename` 修正で同時に解消（個別修正不要）

---

## manifest.webmanifest が middleware で 307 リダイレクトされる

- **発生日**: 2026-05-23
- **発生箇所**: `middleware.ts:149` (matcher 正規表現)
- **フェーズ**: PWA Push 通知導入 (P-2 → V-3 動作確認時に検出)
- **エラー内容**: `curl http://localhost:6001/manifest.webmanifest` が 307 Temporary Redirect を返し、未ログイン状態だと `/login` に飛ばされる。ブラウザがホーム画面追加時に manifest を取得できず PWA 化が失敗する
- **原因**: middleware の matcher 除外パターンに `webmanifest` 拡張子が含まれていなかった。既存の除外は `jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|otf|css|js|map` で、新しく追加した `manifest.webmanifest` が対象外として漏れていた。**Service Worker (`/sw.js`) は `.js` 拡張子のため自動除外されており発覚せず**
- **解決方法**: matcher の除外リストに `|webmanifest` を追加。`'/((?!_next/static|_next/image|api/|.*\\.(?:jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|otf|css|js|map|webmanifest)$).*)'`。修正後 `curl /manifest.webmanifest` が 200 を返すことを確認
- **再発防止**: 新しい静的ファイル拡張子を `public/` に追加する際は、認証チェック不要なら middleware matcher の除外リストにも追加するルールを徹底。PWA 関連は特にログイン前にも取得される (manifest / icons / sw)

---

## 通知メールが集約されず 1 通ずつ送られる

- **発生日**: 〜2026-05-18
- **発生箇所**: `app/api/notifications/enqueue/route.ts:36-65` (旧コード)
- **フェーズ**: 通知メール集約 + cron 信頼化 (Phase A)
- **エラー内容**: お知らせ / 遵守事項 / 研修 / 業務マニュアル を短時間に複数件投稿しても、送信メールが 1 通の digest にまとまらず投稿ごとに 1 通ずつ送られていた
- **原因**: 旧 enqueue は投稿ごとに独立 `scheduled_at = created_at + 2h` を設定し、同テナント他 pending 行を再スケジュールしなかった。cron が 30 分毎に走ると別投稿は別 tick で拾われて 1 通ずつ送信されていた。「2 時間ウィンドウで集約」の意図がコードに存在しなかった
- **解決方法**: enqueue/route.ts を rolling window 化。新規/編集/連投時に同テナントの全 pending 行を最新の `(now + DELAY_HOURS=2)` に揃え、最古行の `first_scheduled_at + MAX_DELAY_HOURS=6` を hardCap として強制送信。migration 180 で `first_scheduled_at` カラム追加 + 24h overdue 破棄 + pending 抽出最適化 INDEX
- **再発防止**: `docs/reference-map.md §0` に migration 180 の意味を明記。`first_scheduled_at` は rolling 揃え替えでは触らない (上限カウントの起点を保持) ことをコメント化

---

## GitHub Actions cron が discard で長期間停止

- **発生日**: 2026-04-24〜2026-05-18 (実測: 4/24 作成 12 件が 5/15 まで 21 日放置、5/18 3 件が 1h44m 遅延、5/16 1 件が 3h14m 遅延)
- **発生箇所**: `.github/workflows/notification-cron.yml`
- **フェーズ**: 通知メール集約 + cron 信頼化 (Phase B)
- **エラー内容**: GitHub Actions schedule で 30 分毎に Vercel `/api/cron/send-notifications` を叩く構成だったが、長時間 1 度も発火しない期間があり通知が出ない
- **原因**: GitHub Actions schedule は公式 best-effort 仕様で SLA 無し。高負荷時に discard が多発する。30 分間隔に下げても解消せず。Vercel Hobby プランは cron 1 日 1 回しか実行できないため代替に GH Actions を使っていたが信頼性不足
- **解決方法**: Supabase pg_cron + pg_net で 10 分毎に Vercel エンドポイントを叩く方式へ移行 (migration 181)。Supabase 内完結で信頼性確保。Vault に `cron_target_url` / `cron_secret` を登録し pg_cron の SQL から `vault.decrypted_secrets` 経由で読む。Vercel 側の `CRON_SECRET` は同じタイミングで rotate して Redeploy
- **再発防止**: `.github/workflows/notification-cron.yml` を削除予定 (24h 観測後)。`docs/reference-map.md §0` に migration 181 / pg_cron ジョブ名 `dispatch_notification_queue` を記載

---

## 書類タブのバッジ件数 ≠ 赤い「再提出する」ボタン数

- **発生日**: 2026-05-18
- **発生箇所**: `app/(employee)/layout.tsx:113-118`（旧コード）
- **フェーズ**: 書類タブ整合性 + 会社発行PDF 重複防止 + 提出フロー混入排除
- **エラー内容**: サイドバー「書類」タブの赤バッジ件数が、`/my/documents` 上で実際に表示される赤い「再提出する」ボタンの数と一致しなかった（バッジは多めに出ていた）
- **原因**: layout.tsx のバッジ計算は `document_submissions.submitted_at < employees.updated_at` の粗い timestamp 比較だけを行っていた。`/my/documents/page.tsx` 側はこれに加えて (a) matrix 除外 / (b) audience フィルタ / (c) `is_company_issued` 除外 / (d) snapshot 比較で「テンプが参照するカラムだけ」比較していたため、両者でロジックがずれていた
- **解決方法**: 共通ヘルパー `lib/document-resubmit-count.ts::countDocumentsNeedingResubmit(supabase, employee)` を新設し、layout.tsx のバッジ計算をこのヘルパー呼び出しに置換。`/my/documents/page.tsx` の per-row 判定と同じフィルタ順序と snapshot 比較を共有
- **再発防止**: `docs/reference-map.md §14d` に「バッジ件数の単一情報源」を明記。将来 layout 側または page 側に新フィルタを足すときは必ず両方に反映する

---

## 会社→社員 発行 PDF が個別発行 / 一括発行 / 招待自動発行で重複できてしまう

- **発生日**: 2026-05-18（本番で重複 8 組 / 16 行が同日 07:56〜07:58 の 90 秒間に発生していたことが migration 適用前調査で判明）
- **発生箇所**: `lib/issued-documents/issue-helper.ts:164-183`（旧コード）/ `supabase/migrations/173_issued_documents.sql`（DB UNIQUE 未設定）
- **フェーズ**: 書類タブ整合性 + 会社発行PDF 重複防止 + 提出フロー混入排除
- **エラー内容**: 同一社員に同じ書類テンプが `revoked_at IS NULL` のまま 2 件以上 active で残っていた
- **原因**:
  1. 一括発行 API には buildPlan で「DB に既存 active があれば skip」する dedup があったが、**「同じ tick で既存 active が無いまま並走している 2 回目の bulk 呼び出し」を防げない**設計だった（admin が一括発行ボタンを 2 連発したり、同時に 2 タブで実行したりすると、1 回目の処理がまだ INSERT 完了前の社員には 2 回目も新規発行が走る）
  2. 個別発行 API・招待時自動発行には dedup 自体が無かった
  3. `issued_documents` に DB UNIQUE 制約が無かったため、レースで通り抜けた重複を最終防御で弾けなかった
- **解決方法**:
  1. **アプリ層 dedup**: `lib/issued-documents/issue-helper.ts` の DB INSERT 直前に `employee_id + document_template_id AND revoked_at IS NULL` の存在チェックを追加。あれば Storage 孤児を削除して日本語エラー返却
  2. **DB 最終防御**: `supabase/migrations/179_issued_documents_unique_active.sql` で部分 UNIQUE INDEX `(employee_id, document_template_id) WHERE revoked_at IS NULL` を作成。アプリ層 dedup を通り抜けたレースもここで UNIQUE 違反 (PG 23505) として弾き、`issue-helper.ts` 側でその違反を検知してユーザー向け日本語メッセージに整形
  3. **UI 強化**: `components/admin/IssueDocumentDialog.tsx` で既発行テンプを disabled + 「発行済」バッジ表示
  4. **既存重複の整理**: migration 179 冒頭で `(employee_id, document_template_id)` の `revoked_at IS NULL` を `issued_at DESC` で順位付け、最新 1 件を残して旧コピーを `revoked_at=now(), revoked_reason='migration 179: 重複発行の整理 (旧コピーを取消)'` で取消。Storage の孤児 PDF も service-role で削除（`scripts/cleanup-orphan-storage.mjs`）
- **再発防止**: `docs/reference-map.md §14d` に「2 段構え (アプリ層 dedup + DB 最終防御)」を明記。revoke 後の再発行は部分 INDEX なので可能

---

## 会社発行 ON テンプが社員側「📄 書類カード」と「📨 会社から届いた書類」の両方に出ていた

- **発生日**: 2026-05-18
- **発生箇所**: `app/(employee)/my/documents/page.tsx:99-102`（旧コード）
- **フェーズ**: 書類タブ整合性 + 会社発行PDF 重複防止 + 提出フロー混入排除
- **エラー内容**: `document_templates.is_company_issued=true` のテンプが社員提出フローの一覧（📄 書類カード）にも出現し、上部の発行カード（📨 会社から届いた書類）と重複表示されていた。さらにそのテンプに対して社員が「内容を確認しました」を押せるため意味の取り違えが発生
- **原因**: `/my/documents/page.tsx` のテンプ filter で `is_company_issued` チェックが入っていなかった（migration 174 で追加したフラグの参照漏れ）
- **解決方法**: page.tsx の filter に `if (t.is_company_issued) return false;` を 1 行追加。会社発行テンプは上部 `IssuedDocumentsSection` でのみ表示
- **再発防止**: `docs/reference-map.md §14d` の `document_templates.is_company_issued 参照` 表に page.tsx を明記。バッジ件数のヘルパーにも同じ除外を入れて、画面と件数の整合を担保

---

## 業務日報 ChildrenTable 左右振り分けが設計時点でルール違反

- **発生日**: 2026-05-16
- **発生箇所**: `components/shift/DailyReportFull.tsx:425-436`（旧コード）
- **フェーズ**: バグ修正セッション
- **エラー内容**: 「左 = 児童発達支援、右 = 放課後等デイサービス」というルールにもかかわらず、放デイ児童のみ利用がある日に放デイが左列に表示される。
- **原因**: 旧実装は `preschool.length > 0` でその日の児発児童数を判定していた。preschool 0 件の日は else 分岐で「放デイを左右に流し込み」(`left = all.slice(0, ROWS); right = all.slice(ROWS, ROWS*2)`)。12 名以下の日は全員左に入って右列が空になる。日単位の判定なので、放デイのみの日があると毎回ルール違反になっていた。コード内コメント（旧 L416-421）も「preschool が居ない施設は放課後を左から流し込み」と意図的にこの設計で書かれていた = 設計判断ミス。
- **解決方法**: 事業所単位（`children` テーブル全件）で「児発児童が 1 人でも登録されているか」を `useMemo` で計算 (`facilityHasPreschool`)。
  ```ts
  const facilityHasPreschool = useMemo(
    () => children.some((c) => classifyService(c.grade_type) === '児童発達'),
    [children],
  );
  ```
  ChildrenTable に prop で渡し、`facilityHasPreschool === true` なら左右固定（preschool 0 名の日は左列が空でも右列に放デイ表示）、`false` なら放デイ専門事業所として左から流し込み（現状維持）。
- **再発防止**: 「その日のデータ」と「事業所として持つ属性」は別の概念。表示ルールを「日単位の有無」で分岐すると、設計意図とズレた瞬間に視覚的にバレる。事業所属性で分岐する判定は `children`/`facilities` 等のマスタテーブルを根拠にする。

---

## 4 カテゴリ管理画面のカテゴリ詳細ヘッダーがモバイルで縦書き化

- **発生日**: 2026-05-16
- **発生箇所**: `app/(admin)/admin/{announcements,compliance,trainings,manuals}/page.tsx` + `app/(manager)/mgr/同` 計 8 ファイル のカテゴリ詳細ビュー（`selectedCategory` がセットされた後の return）
- **フェーズ**: バグ修正セッション
- **エラー内容**: モバイル幅 (≤640px) でカテゴリに入った後のヘッダー（`← 戻る` + アイコン + カテゴリ名 + 一括公開 + 投稿ボタン）でカテゴリ名が 1 文字ずつ縦に並ぶ。
- **原因**: 外側 `flex flex-wrap` の中で右側の操作ボタン群 (`<div className="flex items-center gap-2 flex-wrap ml-auto">`) が `ml-auto` で右端固定。中央の `flex-1` （アイコン + h1）が右ブロックに space を奪われて squeeze され、h1 の `break-words` が日本語を 1 文字ずつ折り返した（CJK は default で word boundary 扱いされるため）。
- **解決方法**:
  - h1: `break-words` → `truncate`（1 行強制）
  - 右ブロック: `ml-auto` → `w-full sm:w-auto sm:ml-auto`（モバイルで w-full にすると flex-wrap で次行に強制 wrap される）
  8 ファイル同パターンを一斉 replace_all。
- **再発防止**: `flex-wrap` 内の `ml-auto` は「space があれば右、なければ次行に wrap」とは限らない。隣の `flex-1` が先に squeeze される。モバイルで意図的に次行送りしたい場合は `w-full sm:w-auto` で明示する。日本語タイトルに `break-words` を使うと CJK が 1 文字ずつ縦に並ぶので、`truncate` か固定 width + `whitespace-nowrap` を推奨。

---

## Turbopack が worktree 配下で next package を解決できず dev server 起動失敗

- **発生日**: 2026-05-16
- **発生箇所**: `.claude/worktrees/clever-wiles-003af3/` 配下で `npm run dev` 実行時
- **フェーズ**: 動作確認のための dev server 起動
- **エラー内容**:
  ```
  Error: Turbopack build failed with 1 errors:
  Error: Next.js inferred your workspace root, but it may not be correct.
  We couldn't find the Next.js package (next/package.json) from the project directory:
  C:\Users\2han2\Projects\deaf-ic\.claude\worktrees\clever-wiles-003af3\app
  ```
- **原因**: git worktree は `.claude/worktrees/<name>/` に作られるが node_modules を持たず、親リポジトリ (`deaf-ic/node_modules/`) を参照する想定。`next.config.ts` の `turbopack.root: '..'` は worktree から見て `.claude/worktrees/` 止まりで親プロジェクトに届かない。Turbopack の filesystem root がそこで切れて next package が見つからない。
- **解決方法**: junction を作って親の node_modules を参照させようとしたら Turbopack が "Symlink ... is invalid, it points out of the filesystem root" で拒否。最終的に worktree 内で `npm install --prefer-offline --no-audit --no-fund` (762 packages, 36 秒) して self-contained に。`.env.local` も親から `Copy-Item` で複製。
- **再発防止**: worktree で初めて dev server を起動する時は (a) `npm install` を worktree 内で実行 (b) 親の `.env.local` を Copy-Item でコピー (PowerShell) — の 2 ステップを最初にやる。これで以降は普通に `npm run dev` で動く。junction / symlink は Turbopack が拒否するので避ける。

---

## 運用ルール

1. エラーが発生して解決したら、作業完了前に必ず記録
2. 同種のエラーが発生したら、まずこのファイルを参照してから対処
3. ユーザーが指摘して初めて発覚したエラーも必ず記録
4. 解決できなかったエラーも「**未解決**」として記録しユーザーに報告
5. 「とりあえず動いた」での記録終了は禁止。原因まで特定する

---

## エラー一覧

---
## sticky 列が背景透けして背面テキストが見える（縦・横スクロールでヘッダー/列固定）

- **発生日**: 2026-05-02
- **発生箇所**: components/shift/BillingFull.tsx（利用料金表ページ） — 他のシフト表・利用表でも同様のパターンが頻出
- **フェーズ**: Phase 66 利用料金表 印刷以外のスクロール対応
- **エラー内容**: `position: sticky` + `left: 40px` / `left: 130px` を `<th style={{ width: '40px' }}>` の宣言値ベースで決め打ちしたところ、横スクロール時に sticky 列の隙間から背面の列（出席日数 / 利用負担額 / 公文代 など）のテキストが透けて見えた。
- **原因**:
  - `table-layout: auto`（既定）における `<th width="...">` や `style={{ width: ... }}` は **ヒント** に過ぎず、ブラウザは内容に応じて列幅を再計算する。
  - 宣言値ベースで `left` を決めると、実際のレンダリング幅が宣言値と1〜数px ずれた瞬間に sticky 列の間に隙間ができる。
  - 隙間部分は z-index の高い sticky cell の背景に守られないため、背面の非 sticky cell（横スクロールで流れている列）の中身が露出する。
- **解決方法**:
  1. `useRef<HTMLTableElement>` で table を掴む。
  2. `useEffect` + `ResizeObserver` で `thead > tr > th` の `getBoundingClientRect().width` を実測。
  3. `--sticky-c2` / `--sticky-c3` という CSS 変数として table の inline style に出力。
  4. CSS 側は `left: var(--sticky-c2, 40px)` のように変数参照（フォールバックで初期値）。
  ```tsx
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [stickyLeft, setStickyLeft] = useState({ c2: 40, c3: 130 });
  useEffect(() => {
    const table = tableRef.current; if (!table) return;
    const measure = () => {
      const cells = table.querySelectorAll('thead > tr > th');
      if (cells.length < 3) return;
      const w1 = (cells[0] as HTMLElement).getBoundingClientRect().width;
      const w2 = (cells[1] as HTMLElement).getBoundingClientRect().width;
      setStickyLeft({ c2: Math.round(w1), c3: Math.round(w1 + w2) });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(table);
    return () => ro.disconnect();
  }, [rows.length, events.length]);
  ```
- **再発防止**:
  - **複数列を横方向に sticky させる場合、left オフセットの px 直書き禁止**。必ず実測 → CSS 変数経由で渡す。
  - sticky cell の背景は **必ず opaque な色を明示**。`background: transparent` / 未指定は禁止。背面の cell はスクロールに連動して動くので、背景がないと必ず透ける。
  - 印刷時は `position: static !important` で sticky を解除する（PDF 上で意図せず固定されるのを防ぐ）。
  - thead 全体を縦方向 sticky にする場合は、スクロール ancestor が「table を内包する div の `overflow: auto`」であることを確認する（`overflow-x-auto` だけだと縦軸 sticky が効かないことがある — overflow-y の used value 規定を理解する）。
  - z-index は corner cell（thead × sticky-col）が最大、thead-only / sticky-col-only がその下、本文セルが最下層。
---
## 役職 (positions) 変更時にシステムロールが勝手に書き換わる

- **発生日**: 2026-04-25（仕様調査で発覚）
- **発生箇所**: supabase/migrations/039_position_roles.sql
- **フェーズ**: 権限整理 / 部署系削除
- **エラー内容**: ユーザーから「役職にロールがついている / システムロールを別で個別設定したい」要望
- **原因**: migration 039 で `positions.system_role` カラム + 2つのトリガー（`trigger_sync_position_role` `trigger_employee_position_role_sync`）が設定済み。役職を変更すると employees.role が自動上書きされる「驚き挙動」になっていた
- **解決方法**: migration 115 で:
  1. 両トリガーを drop
  2. `sync_employee_role_*` 関数 drop
  3. `positions.system_role` カラム drop
  4. UI 側 (settings page) からロール選択セレクタを削除し、リンクで /admin/access-matrix へ誘導
- **再発防止**: 「役職」と「システム権限」は別概念。今後 positions 関連のマイグレーション追加時は権限と切り離す。役職は表示用ラベルとして固定

---
## employees.qualifications が text[] でなく text のまま（.map is not a function）

- **発生日**: 2026-04-25
- **発生箇所**: components/shift/StaffSettingsFull.tsx 568行目 `(s.qualifications ?? []).map(...)`
- **フェーズ**: タスクD 着手前
- **エラー内容**: `Runtime TypeError: (s.qualifications ?? []).map is not a function`
- **原因**: 003_employees.sql で `qualifications text` として作成済 → 104_shift_settings_extend.sql の `add column if not exists qualifications text[]` は既存 text 列があるため **skip された**。本番 DB は text のままで、コードは text[] 前提のため `.map` が実行できなかった。`?? []` は null/undefined しか拾わないため文字列値は素通り。
- **解決方法**: migration 114_employees_qualifications_array_fix.sql を新規作成し、`alter column qualifications type text[] using case when null/empty then '{}' else string_to_array(value, ',') end` で型変換。default '{}'::text[] / not null 再付与。
- **再発防止**: `add column if not exists ... TYPE` は **既存カラムの型不一致を検出しない**。スキーマ拡張のマイグレーションでは「先に列の存在と型を information_schema.columns で確認」または「事前に drop column」する必要がある。今後の `add column if not exists` 使用時は対象カラムが過去に別型で作られていないか必ず確認する。

---
## shift_requests INSERT で submitted_by_employee_id カラム未存在エラー

- **発生日**: 2026-04-25
- **発生箇所**: components/shift/MyRequestsView.tsx 209行目
- **フェーズ**: タスクC（休み希望）
- **エラー内容**: `保存失敗: Could not find the 'submitted_by_employee_id' column of 'shift_requests' in the schema cache`
- **原因**: コード側でカラム名を `submitted_by_employee_id` と書いていたが、migration 100 の実カラム名は `submitted_by` (uuid references employees(id))。シフトパズル時代のカラム名 `submitted_by_staff_id` を参考にしたタイミングでズレた可能性
- **解決方法**: `submitted_by_employee_id: employeeId` → `submitted_by: employeeId`
- **再発防止**: shift系テーブルへ INSERT/UPDATE する際は `supabase/migrations/100_shift_core.sql` のカラム名を必ず先に確認する。staffbase の語彙（employee_id）と shift-maker の語彙（staff_id）が混在しがちなので、特に submitter/owner 系カラムは要確認

---
## NotificationContentType 拡張で既存 Record 型が型エラー

- **発生日**: 2026-04-25
- **発生箇所**: lib/email/notification-email.ts (TYPE_LABEL/TYPE_PATH), app/api/cron/send-notifications/route.ts (CONTENT_TABLE)
- **フェーズ**: タスクA Phase 5 公開フロー
- **エラー内容**: `Type '{ announcement: string; compliance: string; training: string; }' is missing the following properties from type 'Record<NotificationContentType, string>': shift_ready, shift_publish`
- **原因**: migration 106 で `notification_queue.content_type` に shift_ready / shift_publish を追加した際、`NotificationContentType` 型を5タイプに拡張したため、既存3タイプのみで実装された Record<...> 型が型不足になった
- **解決方法**: 型を分割
  ```ts
  // lib/types.ts
  export type LegacyNotificationContentType = 'announcement' | 'compliance' | 'training';
  export type ShiftNotificationContentType = 'shift_ready' | 'shift_publish';
  export type NotificationContentType = LegacyNotificationContentType | ShiftNotificationContentType;
  ```
  既存3タイプ用の Record は LegacyNotificationContentType に変更、シフト系は別関数（buildShiftPublishEmail / buildShiftReadyEmail）+ cron 内で `processShiftRow` にディスパッチ
- **再発防止**: Discriminated Union を拡張する際は、既存の `Record<UnionType, T>` に依存している箇所を grep で確認してから着手

---
## ポート 6000 で Next.js 起動失敗

- **発生日**: 2026-04-24
- **発生箇所**: package.json scripts.dev
- **フェーズ**: Phase 0
- **エラー内容**: `Bad port: "6000" is reserved for x11`
- **原因**: ポート 6000 は X11 用に予約されており、Chrome の `ERR_UNSAFE_PORT` リストにも含まれているため Next.js が起動を拒否する
- **解決方法**: `next dev -p 6000` → `next dev -p 6001` に変更
- **再発防止**: 開発ポートを選ぶ際は次の予約ポートを避ける: 1, 7, 9, 11, 13, 19, 21, 22, 23, 25, 53, 80, 110, 143, 443, 3659, **6000**, 6566, 6665-6669, 10080。3000/3001/4003/5173/6001/8080 などが安全。

---
## /api/auth/register が 400 Invalid path specified in request URL

- **発生日**: 2026-04-24
- **発生箇所**: app/api/auth/register/route.ts → Supabase auth.admin.createUser
- **フェーズ**: Phase 0
- **エラー内容**: `{"error":"Invalid path specified in request URL"} HTTP 400`
- **原因**: `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` が REST API エンドポイント `https://xxx.supabase.co/rest/v1/` に設定されていた。SDK は `/rest/v1/`、`/auth/v1/` 等を base URL に自動付加するため、`/rest/v1/` が含まれた URL に再付加されて壊れた URL になり Auth Admin API が path を解釈できなかった。
- **解決方法**: `NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co/rest/v1/` → `NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co`（プロジェクト URL のみ）に修正
- **再発防止**: Supabase ダッシュボード → Settings → API の「**Project URL**」欄をコピーする（「REST URL」欄ではない）。`/rest/v1/` 等のパス suffix は付けない。

---
## sort_order カラム未存在で list/insert が 400

- **発生日**: 2026-04-24
- **発生箇所**: app/(admin)/admin/compliance/page.tsx の reload + insert 処理
- **フェーズ**: Phase 1.5
- **エラー内容**: `GET /rest/v1/compliance_documents?...&order=sort_order.asc.nullslast 400`
- **原因**: コード側で `.order('sort_order')` を使ったが、対応する migration 092_sort_order.sql が Supabase に未適用だった。PostgREST は存在しないカラムでの ORDER BY を 400 で拒否する。
- **解決方法**:
  1. ユーザーに migration 092 適用を依頼
  2. `lib/sort-helpers.ts` の `nextSortOrder` を try/catch で包み、エラー時に null 返却 → insert 時に `sort_order` キー自体を含めない fault-tolerant 実装に
- **再発防止**: 新カラムを参照する前に必ず migration 適用済みかユーザーに確認。コード側でも fault-tolerant に書く（カラム未存在を許容）。

---
## Breadcrumb の「ホーム」リンクが 404

- **発生日**: 2026-04-24
- **発生箇所**: components/admin/Breadcrumb.tsx
- **フェーズ**: Phase 1.5
- **エラー内容**: `/admin` `/mgr` `/my` をホーム リンクとして生成していたが、それらは実ルートでなく page.tsx が無いため 404
- **原因**: パンくず生成時にロール直下パス（`/admin`, `/mgr`, `/my`）を「ホーム」として href に使っていた
- **解決方法**: ロール直下パスは `ROLE_ROOT_REDIRECT` で `/admin/dashboard` 等にリダイレクト扱い。一段目のパンくずは必ず dashboard（`🏠 ダッシュボード` または `🏠 ホーム`）にリンク。
- **再発防止**: パンくずに使う href は必ず実在する page.tsx と対応するパスかチェック。動的セグメントや role-root のような virtual パスを href にしない。

---
## RoleSwitcher の不要な Supabase クエリ（パフォーマンス）

- **発生日**: 2026-04-24
- **発生箇所**: components/RoleSwitcher.tsx
- **フェーズ**: Phase 1
- **エラー内容**: super_admin 削除後も RoleSwitcher が全ページで auth.getUser + employees.role クエリを発行し続けていた
- **原因**: super_admin 判定をクライアントサイドで実行する設計だったが、ロール削除に伴い常に false になる無駄なクエリ
- **解決方法**: コンポーネント本体を `return null` のみに置換。Phase 4 で manager/employee 切替を再実装する旨をコメントで明記
- **再発防止**: ロール削除など破壊的変更時、関連コンポーネントの動作も合わせて確認。

---
## Dialog コンポーネントがカテゴリ一覧 view の return ブロック外にある

- **発生日**: 2026-04-24
- **発生箇所**: app/(admin)/admin/{compliance,trainings,announcements}/page.tsx
- **フェーズ**: Phase 1.5
- **エラー内容**: カテゴリ一覧 view の「新規作成」ボタンを押しても何も起きない（Dialog が render tree に存在しない）
- **原因**: `if (!selectedCategory) return (...)` の return ブロックの後に Dialog を配置していたため、一覧 view ではダイアログが unmount 状態だった
- **解決方法**: 一覧 view の「新規作成」ボタン自体を削除し、カテゴリ詳細 view からのみ新規作成可能に変更。詳細 view では category_id がデフォルトでそのカテゴリに設定される
- **再発防止**: 同一ページに複数 return がある場合、Dialog/Modal はトップレベル（最後の return の中、または外）に配置するか、各 return ブロックに含める。

---
## 遵守事項: 既存プレーンテキスト doc が BlockEditor 適用後に編集不可

- **発生日**: 2026-04-24
- **発生箇所**: app/(admin)/admin/compliance/page.tsx `openEdit` + app/(manager)/mgr/compliance/page.tsx `openEdit`
- **フェーズ**: Phase 1.7（manager BlockEditor 移植時にユーザー指摘で発覚）
- **エラー内容**: BlockEditor を適用後、保存ボタンが `editBlocks.length === 0` で disabled になるため、`content_blocks` が空で `content` のみ持つ旧データが編集できない
- **原因**: 旧データは `content`（プレーンテキスト）に本文を格納していたが、BlockEditor は `content_blocks` を参照。openEdit 時に content_blocks しか見ておらず、旧 content を無視していた
- **解決方法**: openEdit 時に `content_blocks` が空かつ `content` があれば `[{type:'text', value: content}]` として seed。ユーザーは既存テキストをそのまま編集でき、保存時に `content_blocks` に取り込まれる
- **再発防止**: 新エディタを既存データに適用する際は「旧フィールド→新フィールドへの自動seed」を必ずopenEditに実装。disabled 条件も「旧データのまま」でトリガーされないよう検証する

---
## 社員 名前/カナの保存ができない（NOT NULL 違反）

- **発生日**: 2026-04-28
- **発生箇所**: app/(admin)/admin/employees/[id]/page.tsx `saveBasicEdit`
- **フェーズ**: Phase 64 着手前
- **エラー内容**: 社員詳細画面で姓・名・姓カナ・名カナを編集して保存するとエラー（toast に PostgreSQL の NOT NULL 制約違反メッセージ）
- **原因**: `saveBasicEdit` で `payload[k] = v === '' ? null : v` と空文字を null に変換していたが、`employees.last_name / first_name / last_name_kana / first_name_kana` は NOT NULL 制約。ユーザーがフィールドをクリアした状態で保存すると DB が拒否
- **解決方法**: `REQUIRED_BASIC_KEYS = ['last_name','first_name','last_name_kana','first_name_kana']` を定義し、保存前に空文字 / 空白のみをトーストでブロック。それ以外のカラムは従来どおり空文字 → null 化を許可
- **再発防止**: NOT NULL 列に対する空文字 → null 一括変換は危険。フォーム保存時に必須カラムリストを明示してフロントでブロックする運用にする

---
## 利用料金表 出席日数が常に 0 になる

- **発生日**: 2026-04-28
- **発生箇所**: components/shift/BillingFull.tsx fetchAll の出席カウント、および ScheduleFull の出欠 UI
- **フェーズ**: Phase 66-C 動作確認時にユーザー指摘
- **エラー内容**: 利用料金表ページで全児童の「出席日数」が 0。利用表に時間を入れても反映されない
- **原因**: 出席判定が `attendance_status === 'present'` のハード一致だったため、PDF インポート直後の `planned + 時間あり` 状態が出席扱いにならず、毎回手動で「出席」ボタンを押す運用になっていた
- **解決方法**: deaf-ic 仕様として「時間が入っていれば自動で出席扱い」を一元化。
  - 出席判定ロジック: `(pickup_time != null OR dropoff_time != null) AND attendance_status NOT IN ('absent', 'leave', 'waitlist')`
  - 利用表モーダルから「出席」ボタン削除（3 ボタン化: お休み / 欠席 / キャンセル待ち、各ボタントグル解除可）
  - present / late / early_leave ステータスは既存データ互換のため enum に残置（UI からは設定しない）
- **再発防止**: 「明示マーク必須」型の運用は現場（放デイ）に合わない。"自動で出席、欠席連絡だけマーク" の方が運用負荷が小さく、忘れによる集計ミスも起きない。出席判定はこの 1 行ロジックに統一（CLAUDE.md §10 出欠記録に明記）

---
## 部下プロフィール詳細ページが manager で「閲覧する権限がありません」になる

- **発生日**: 2026-05-02
- **発生箇所**: app/(manager)/mgr/subordinates/[id]/page.tsx + supabase/migrations/149-151
- **フェーズ**: マネージャー部下管理（148 で一覧 RPC 化した後の追従漏れ）
- **エラー内容**: マネージャーで部下管理一覧から社員行をクリック → 「この社員の情報を閲覧する権限がありません」。最終的に発覚した PostgreSQL エラーは `cannot pass more than 100 arguments to a function (SQLSTATE 54023)`
- **原因**:
  1. (一次) 一覧は migration 148 の SECURITY DEFINER RPC `get_my_subordinates` 経由に切り替わっていたが、詳細ページ `[id]/page.tsx` は `from('employees').select(...)` の直接クエリのまま残っていた。`employees` の RLS は manager に SELECT を許可していない（144 で許可しようとしたら全員ログアウト現象 → 145 で即ロールバックされた経緯）ため、詳細ページだけ無言で空返却 → 「権限がありません」
  2. (二次) 詳細用 RPC `get_subordinate_detail` を migration 149 で追加したが、`jsonb_build_object` の引数上限 (100) を超えていた。`MANAGER_VISIBLE_FIELDS` が 62 ペア = 124 引数になり PostgreSQL が拒否
  3. (三次) デバッグ用 EXCEPTION ハンドラで `PG_EXCEPTION_CONTEXT` を式中で直接参照したが、これは `GET STACKED DIAGNOSTICS` 経由でしか取得できないため、ハンドラ自身が `column "pg_exception_context" does not exist (42703)` で落ち、原因が長く隠れた
- **解決方法**:
  1. 一覧と同様に `employees` 直クエリ → SECURITY DEFINER RPC へ切替（149 で `get_subordinate_detail(p_id uuid)` を追加。admin/manager/shift_manager の認可判定込み、返却フィールドは `MANAGER_VISIBLE_FIELDS` 限定）
  2. `jsonb_build_object` を 2 ブロック（49 ペア + 13 ペア）に分割し `||` 演算子で連結（migration 151）
  3. 例外コンテキスト取得は `GET STACKED DIAGNOSTICS v_context = PG_EXCEPTION_CONTEXT;` を使う。式中の直接参照は不可（migration 150 修正版）
- **再発防止**:
  - **`employees` テーブルに対する manager の SELECT は SECURITY DEFINER RPC 経由が原則**。RLS を直接いじると 144 のような全員ログアウト級の事故が起きる（前科あり）。manager 専用の取得点を増やす時は同じパターンで RPC を追加する
  - **`jsonb_build_object` は 100 引数 (= 50 ペア) 上限**。多列の jsonb 化は 2 ブロックに分けて `||` で連結するか、`row_to_json(e)::jsonb` ベースで作って不要列を削る方が安全
  - **PostgrestError は `console.error('text', err)` で `{}` に潰れる**。デバッグ時は `{ message, code, details, hint }` の形で個別フィールドを出す（PostgrestError のプロパティが non-enumerable のため）
  - **plpgsql の特殊変数の使い分け**: `SQLERRM` / `SQLSTATE` は式中で直接使える。`PG_EXCEPTION_CONTEXT` / `PG_EXCEPTION_DETAIL` / `PG_EXCEPTION_HINT` は `GET STACKED DIAGNOSTICS` 経由必須
  - migration 適用直後は PostgREST スキーマキャッシュが古いことがある。新規 RPC を追加する migration は末尾に `NOTIFY pgrst, 'reload schema';` を入れておく

---
## get_my_subordinates が 400 で失敗 → 部下一覧が表示されない (2 段重ね)

- **発生日**: 2026-05-02
- **発生箇所**: supabase/migrations/147 + 148 → 152/153 で修正
- **フェーズ**: マネージャー部下管理（149/151 で詳細ページを RPC 化した直後の二次故障）
- **エラー内容**:
  - 1 段目: 400 Bad Request、エラー内容空（PostgREST がオーバーロード解決できず）
  - 2 段目: `column reference "facility_id" is ambiguous` (SQLSTATE 42702)
- **原因**:
  1. **オーバーロード重複**: 147 で `get_my_subordinates()` (no-arg)、148 で `get_my_subordinates(p_facility_id uuid DEFAULT NULL)` (1-arg) を `CREATE OR REPLACE` のみで追加し、no-arg 版を DROP していなかった。両シグネチャが DB に共存し、PostgREST のスキーマキャッシュが両方を認識した時点で `supabase.rpc('get_my_subordinates', { p_facility_id })` の解決に失敗 → 400
  2. **ambiguous column**: 1-arg 版の `RETURNS TABLE (... facility_id uuid ...)` で宣言した OUT パラメータ名 `facility_id` が、関数本体の CTE / SELECT 内の bare `facility_id` 参照（`SELECT facility_id FROM employees`、`SELECT facility_id FROM managed_fids` 等）と衝突。これは 148 時点から潜在していた latent bug だが、no-arg 版がオーバーロードとして残っている間は PostgREST がそちらを呼んでいたため発覚していなかった
- **解決方法**:
  1. migration 152: `DROP FUNCTION IF EXISTS public.get_my_subordinates();` で no-arg 版を削除（1-arg 版だけ残す）
  2. migration 153: 1-arg 版を `CREATE OR REPLACE`、CTE / SELECT 内の bare `facility_id` を全て qualifier 付きに書き換え:
     - `employees` 列 → `e2.facility_id`
     - `manager_facilities` 列 → `mf2.facility_id`
     - CTE 列 → `managed_fids.fid`（CTE 出力列名自体も `facility_id` 衝突回避のため `fid` にリネーム）
  3. 両 migration 末尾に `NOTIFY pgrst, 'reload schema';` を入れて即座にスキーマキャッシュを再構築
- **再発防止**:
  - **`CREATE OR REPLACE FUNCTION` は同一シグネチャしか上書きしない**。引数を追加/変更する場合は `DROP FUNCTION ... (旧シグネチャ); CREATE FUNCTION ... (新シグネチャ);` の順で書く。さもなくばオーバーロードが増殖する
  - **`RETURNS TABLE (...)` で宣言した出力列名は関数本体の OUT パラメータ**になり、bare 参照と衝突する。RETURNS TABLE を使うなら本体内の SQL は **必ず table.col 形式で qualify する**。CTE 名も出力列名と被らないように
  - **PostgREST スキーマキャッシュは必ず NOTIFY で再ロードする**（`NOTIFY pgrst, 'reload schema';`）。新規 RPC 追加・関数削除時は migration 末尾に常に入れる

---
## notifications テーブルへの INSERT が本番で 403 (個別メッセージ送信不可)

- **発生日**: 2026-05-16
- **発生箇所**: 個別メッセージ送信フロー (`/admin/messages`, `/mgr/messages`) → notifications テーブルへの INSERT
- **フェーズ**: 本番運用中 (Phase G 以降)
- **エラー内容**: `403 Forbidden / new row violates row-level security policy for table "notifications"`
- **原因**: migration 139 で notifications に RLS を有効化したが、その時 `SELECT/UPDATE/DELETE` ポリシーのみ定義しており **INSERT ポリシーが完全に欠落** していた。RLS 有効 + INSERT ポリシー無し = 全 INSERT が拒否される（PostgreSQL の RLS のデフォルト動作: ポリシーが無いと「許可なし」と解釈）。これにより:
  - 個別メッセージ (`message_threads → messages → notifications`) の通知発火が失敗
  - シフト変更申請の admin 宛通知も失敗
  - cron 経由のお知らせ/遵守事項/研修/業務マニュアル通知は service_role なので影響無し
- **解決方法**: migration 158 で INSERT ポリシーを追加:
  ```sql
  create policy notif_actor_insert on public.notifications for insert
    with check (
      actor_employee_id = (select id from public.employees where auth_user_id = auth.uid() limit 1)
      and tenant_id = (select tenant_id from public.employees where auth_user_id = auth.uid() limit 1)
    );
  ```
  `actor_employee_id` が自分の employees.id と一致 + tenant 一致を WITH CHECK で強制。本番に直接 pooler 経由で適用済。
- **再発防止**:
  - **RLS を ENABLE TABLE する migration では SELECT/INSERT/UPDATE/DELETE の 4 ポリシー全てを定義する** か、不要なら明示的に `policy ... for all using (false)` 等で意図を残す
  - 「クライアントから INSERT されるテーブル」と「service_role からのみ INSERT されるテーブル」を判別し、前者は必ず INSERT ポリシーを書く
  - RLS 有効化と同 migration 内で 4 operation 全てのポリシーを列挙する規約にする

---
## `column reference "facility_id" is ambiguous` — 個別メッセージ送信時 (158 適用後に顕在化)

- **発生日**: 2026-05-16
- **発生箇所**: `supabase/migrations/142_direct_messages.sql:138` の `can_admin_view_thread()` 関数内
- **フェーズ**: 本番運用中
- **エラー内容**: `column reference "facility_id" is ambiguous` (SQLSTATE 42702) — 個別メッセージ送信時の messages.insert.select() RETURNING 評価で発生
- **原因**: `can_admin_view_thread()` 関数の manager 経路で以下の UNION サブクエリの 2 つ目のブランチ:
  ```sql
  select facility_id from public.manager_facilities mf
  join public.employees e on e.id = mf.employee_id where e.auth_user_id = auth.uid()
  ```
  `manager_facilities` と `employees` の両テーブルに `facility_id` 列があるため、無修飾 `facility_id` は ambiguous で PG が 42702 を投げる。
- **これまで顕在化しなかった理由**: 上記の notifications 403 バグで個別メッセージ送信が早期失敗 → can_admin_view_thread の manager 経路まで到達しなかった。**158 で notifications INSERT を通したことで初めて messages.insert.select() の RETURNING で RLS の OR 評価がフル実行され、潜在バグが顕在化した**。「片方を直したら隣の壊れていたバグが見える」典型ケース。
- **解決方法**: migration 159 で関数を `CREATE OR REPLACE`、138 行目を `select mf.facility_id from public.manager_facilities mf` に変更 (テーブル修飾子を付与)。pooler 経由で本番適用 + `pg_get_functiondef` で本体を検証済。
- **再発防止**:
  - **JOIN を含むサブクエリでは全列を必ず table.col で qualify する**。SELECT リスト・WHERE 句・GROUP BY 全てに適用
  - 既存の類似事例: migration 152/153 でも同じ ambiguous 問題があった (`get_my_subordinates`)。この種の bare column reference は **新規 migration 作成時に必ず JOIN 列を grep でチェック**
  - **PostgreSQL の OR 条件は短絡評価されない**: `policy ... USING (foo OR bar)` で foo が true でも bar も評価されうる。RLS ポリシーで関数を OR 接続する場合、両関数とも例外を投げない実装にする
  - **依存バグの「壁」を片方だけ直すと隣のバグが露出する**: 修正範囲を絞るときも「次に通る経路」を読み切ってから commit する。今回は migration 158 単独で 1 セッション完結させたのが甘く、158 適用直後に 159 が必要だと事前に検出できていなかった

---
## /admin/manuals + /admin/announcements に編集ボタンが存在しなかった

- **発生日**: 2026-05-16
- **発生箇所**: `app/(admin)/admin/manuals/page.tsx`, `app/(admin)/admin/announcements/page.tsx`
- **フェーズ**: 本番運用中
- **エラー内容**: ユーザー指摘「業務マニュアルが編集できない、ボタンがない」「お知らせも同様」
- **原因**: compliance / trainings は実装時に editingDoc / openEdit / handleSave (update branch) / handleDelete を入れていたが、manuals / announcements は新規投稿しかフローを書いていなかった。コード差分のレビュー時に「同じ 4 機能なのに 2 つにしか CRUD が無い」点が見過ごされた
- **解決方法**: 両ページに以下を追加:
  - `editingManual` / `editingAnnouncement` state
  - `openEdit(row)` 関数 (form と blocks に値を流し込んで dialog 起動)
  - `handleSave` を if (editing) update / else insert で分岐
  - `handleDelete` 関数 + `cancelNotification('manual'|'announcement', id)` でキューもキャンセル
  - Dialog タイトル「業務マニュアルの編集 / 業務マニュアルの追加」の出し分け
  - `announcements` テーブルは `updated_at` 列が無い (007 で created_at のみ) ため、update payload には updated_by のみ含める
  - card の右側ボタン群に `編集` (filled diletto-blue) + `削除` (赤 outline) を追加
- **再発防止**:
  - **4 機能 (compliance / training / announcement / manual) は同一の CRUD UI を持つはず**。新規追加時は 4 ページ横断で「投稿 / 編集 / 削除 / 公開トグル / 同意状況 (compliance のみ)」が揃っているかをチェックリスト化する
  - compliance 側を「カノニカル」として、新機能はまず compliance に入れてから他 3 ページに展開する規約にする
  - `git grep "openEdit\|handleDelete"` で 4 ページのどこに何が無いか即座に判別できる

---
## /admin/compliance + /admin/trainings の編集ボタンが小さくて見えない

- **発生日**: 2026-05-16
- **発生箇所**: `app/(admin)/admin/compliance/page.tsx`, `app/(admin)/admin/trainings/page.tsx`
- **フェーズ**: 本番運用中
- **エラー内容**: ユーザー指摘「ボタンが小さく見えない」(視覚的な問題、機能エラーではない)
- **原因**: 当初実装で `Button variant="outline" size="sm" className="h-8 rounded-md text-xs font-bold"` というスタイルを適用していた。`h-8` (32px) + `text-xs` (12px) で「カード内の他バッジ群と並ぶと埋もれる」状態。outline で背景白 → カード白 → 境界線がほぼ見えない
- **解決方法**: 統一ルールを設定 (4 機能横断):
  - **編集**: `bg-diletto-blue text-white font-bold` (✎ アイコン付き) — filled で目立たせる
  - **削除**: `text-diletto-red border-diletto-red/40 outline hover:bg-diletto-red/10` — 色で危険性を示す
  - 共通: `h-8 text-xs` を撤廃し、Button のデフォルトサイズを使用 (size="sm" のみ残す)
- **再発防止**:
  - 「アクションボタンが情報バッジと同じ高さ・色だと埋もれる」を覚える。アクション系は背景色 + アイコン + 通常サイズで視覚的優先度を上げる
  - shadcn ベース UI で size="sm" 以下を多用しない (h-8 や text-xs を上書きするのは特殊ケースのみ)

---
## 研修モーダルを開いただけで「閲覧」カウントが計上される

- **発生日**: 2026-05-16
- **発生箇所**: `app/(employee)/my/trainings/page.tsx` の研修詳細モーダル
- **フェーズ**: 本番運用中
- **エラー内容**: ユーザー指摘「研修はモーダル開いたら既読カウントが外れてない、提出回数のみカウントにしてほしい」
- **原因**: モーダルに `<ViewConfirmButton category="training" itemId={...} />` を埋めており、開いた時点で `training_view_logs` に行が追加され「閲覧回数」が増えていた。研修は他 3 機能と違って **「閲覧」ではなく「提出 (training_submissions)」が実質の受講記録** であるべき
- **解決方法**:
  - `<ViewConfirmButton>` をモーダルから削除
  - 代わりに「これまで N 回 提出済み」の display-only テキストを表示 (submissions.filter(s => s.training_id === t.id).length)
  - `/api/reports/route.ts` の training_submissions 取得を `.order('submitted_at', { ascending: false })` に変更 (履歴 tooltip 表示用)
  - `ReportMatrix.tsx` で 合否バッジに `title` 属性で全提出履歴の tooltip を付与 (② の閲覧履歴 tooltip と同じ UX)
- **再発防止**:
  - **「閲覧」と「提出」を混同しない**: 4 機能のうち training だけ提出フローがある。研修は閲覧回数 ≠ 受講回数なので、UI/集計の両方で submissions を一次ソースに使う
  - モーダル open イベントでログを書く UI コンポーネントは、その意味的妥当性を機能ごとに確認する

---
## モーダル誤閉対策の whitelist 方式が効かなかった (キーボード入力で閉じる問題が解消しない)

- **発生日**: 2026-05-16
- **発生箇所**: `components/ui/dialog.tsx` の Dialog ラッパー
- **フェーズ**: 本番運用中 (前回 ③ 修正の不完全さがユーザー指摘で発覚)
- **エラー内容**: キーボード入力 (escape-key / focus-out など) でモーダルが閉じる問題に対し、`onOpenChange` 内で `return` するだけの whitelist 方式を入れたが解消しなかった
- **原因 (真因)**: `@base-ui/react` の `DialogStore.setOpen()` (`node_modules/@base-ui/react/dialog/store/DialogStore.js:37-69`) の構造を読み切れていなかった:
  ```js
  setOpen = (nextOpen, eventDetails) => {
    ...
    this.context.onOpenChange?.(nextOpen, eventDetails);  // 親の onOpenChange を呼ぶ
    if (eventDetails.isCanceled) {                         // ★ cancel() 呼ばれてれば早期 return
      return;
    }
    ...
    this.update(updatedState);  // ← 呼ばれてなければ open=false に強制更新（controlled open=true を無視）
  };
  ```
  親の `onOpenChange` (= my whitelist wrapper) が `return` するだけでは `eventDetails.isCanceled` が `false` のままなので、base-ui が内部 state を強制的に `open=false` に上書きしてダイアログが閉じる。controlled の `open` プロップは内部 state を上書きするためのものだが、`useControlledProp` は次のレンダー時にしか syncronize しない (`useIsoLayoutEffect` 経由)。つまり ① base-ui が `update({ open: false })` を呼んで内部 state が即座に false になり ② React レンダーが走り親の open=true がまだあるので useIsoLayoutEffect が一瞬後に open=true に戻すが、③ その間に exit アニメーションが走ってモーダルが消失 (= ユーザー視点では「閉じた」)。
- **解決方法**: `eventDetails.cancel()` を必ず呼ぶ。`@base-ui/react/utils/createBaseUIEventDetails.d.ts:53` に `cancel: () => void` が定義されており、これを呼ぶと `isCanceled=true` になって base-ui の内部 state 更新がスキップされる:
  ```tsx
  const handleOpenChange = React.useCallback(
    (open, eventDetails) => {
      if (!open && !ALLOWED_CLOSE_REASONS.has(eventDetails.reason)) {
        eventDetails.cancel();  // ★ これが無いと base-ui が勝手に閉じる
        return;
      }
      onOpenChange?.(open, eventDetails);
    },
    [onOpenChange],
  );
  ```
- **再発防止**:
  - **3rd party UI ライブラリの「親の onChange を呼んだ後の処理」を読み切る**。`onOpenChange` のような callback は単なる通知ではなく、internal state 更新と並列で走る可能性がある。`return` で「親に伝えない」だけでは不十分なケースが多い
  - **API ドキュメント (TypeScript 型定義) で `cancel` / `preventDefault` / `stopPropagation` 系メソッドの存在を確認する**。`BaseUIChangeEventDetail` 型に `cancel: () => void` という明示的なメソッドがあった。一度型定義を読めば見つけられた
  - **修正後の動作確認はユーザー任せにしない**。前回「ホワイトリスト方式に強化」とコミットメッセージを書いて push したが、実機での動作テストをユーザーに丸投げした結果、不完全な修正のまま 2 セッション跨ぐことになった。動作確認できない場合は `npm run dev` を起動して console.log でイベント reason を実観測すべきだった
  - **「対症療法と根本治療を区別する」**: `disablePointerDismissal=true` で pointer dismissal は止まるが、base-ui の state 機構は依然として close を発火する。レイヤごとの責務を理解する

---
## 研修感想文モーダルがキーボード入力で閉じる (真因は Dialog ではなく nested function component)

- **発生日**: 2026-05-16
- **発生箇所**: `app/(employee)/my/trainings/page.tsx` line 338 で宣言された nested `TrainingsGrid` 関数
- **フェーズ**: 本番運用中
- **エラー内容**: 研修詳細モーダル内の Textarea (受講の感想) に 1 文字入力した瞬間にモーダルが閉じる
- **原因 (真因)**:
  ```tsx
  function MyTrainingsPage() {   // 親
    const [summaryTexts, setSummaryTexts] = useState({});
    ...
    function TrainingsGrid({...}) {  // ★ 親の中で宣言された nested function component
      const [openId, setOpenId] = useState(null);
      return (
        <Dialog open={!!openId} ...>
          <Textarea onChange={(e) => setSummaryTexts(...)} />  // ★ 親 state を更新
        </Dialog>
      );
    }
    return <TrainingsGrid ... />;
  }
  ```
  Textarea で 1 文字打つたびに:
  1. `setSummaryTexts` で **親** MyTrainingsPage が再レンダー
  2. 親の render 関数本体が再評価される → `function TrainingsGrid(...) { ... }` が新しい関数オブジェクトとして再生成される (関数識別子は親 render ごとに別物)
  3. React reconciler が `<TrainingsGrid />` の type プロップを `===` で比較 → 別関数 → 別のコンポーネントツリーと判定
  4. **古い TrainingsGrid を unmount し、新しい TrainingsGrid を mount**
  5. 新しい TrainingsGrid の `useState(null)` で `openId` が null に初期化される
  6. Dialog の `open={!!openId}` が false → exit アニメーション → 閉じる

  これは React の最頻出 anti-pattern の一つで、ESLint の `react/no-unstable-nested-components` が検出してくれるルールでもある。
- **これまで気付かなかった理由**: 開発者 (自分) が「Dialog の close は base-ui の onOpenChange 経由でしか起きない」と思い込んでいた。実際には parent の controlled `open` プロップが false に変わることでも閉じる。nested function の remount で local state がリセットされる経路を完全に見落としていた。前回 ③ で `eventDetails.cancel()` を入れる修正に走ったが、Dialog ラッパーは無関係だった。
- **解決方法**: `TrainingsGrid` を `MyTrainingsPage` の外 (module level) に抽出し、`tenantId` / `employeeId` / `viewSummaries` を props で渡す。`RESULT_LABEL` / `RESULT_COLOR` も module level の const に移動。これで親の再レンダーが TrainingsGrid を remount しなくなり、`openId` state が保持される。
- **再発防止**:
  - **コンポーネントは絶対に他コンポーネントの内側で宣言しない**。`function Parent() { function Child() {} }` のパターンは、子が state を持つ場合に必ず壊れる。Hooks も無効になる
  - **`react/no-unstable-nested-components` ESLint ルールを有効化する**。eslint-plugin-react に含まれる
  - **「state がリセットされる」現象を見たら、まず親コンポーネントが child を不安定に作っていないか疑う**。Dialog や useState 内部の挙動を疑う前に
  - **同じバグの第二歩を間違えない**: 今回 ① 私は `disablePointerDismissal=true` の whitelist 方式で「閉じる reason をブロックすればよい」と決めつけた ② ユーザー報告で再発 → 「base-ui の cancel() を呼べばよい」と更に決めつけた ③ 再再発でようやく親で何が起きているかを調べた。**1 回目の修正で直らなかった時点で、症状の出方 (どのモーダル? どの入力? 親で何が起きてる?) を聞き、推論前提を全部疑うべきだった**

---
## Dialog 外クリックで閉じなくなった (前回 ③ 修正による regression)

- **発生日**: 2026-05-16
- **発生箇所**: `components/ui/dialog.tsx` の `disablePointerDismissal = true` デフォルト + `ALLOWED_CLOSE_REASONS` whitelist
- **フェーズ**: 本番運用中
- **エラー内容**: モーダル外をクリックしても閉じない (ユーザー報告「不便」)
- **原因**: 前回 ③ の修正で「キーボード入力で閉じる」を防ごうとして:
  - `disablePointerDismissal = true` をデフォルトに → 外クリックの dismissal を base-ui レベルで無効化
  - `ALLOWED_CLOSE_REASONS = { close-press, trigger-press, imperative-action }` whitelist で `outside-press` も `escape-key` も全部ブロック

  実際には「キーボードで閉じる」の真因は別 (nested function の remount) で、Dialog ラッパーには何の責任もなかった。過剰防御が外クリック/ESC まで全部殺してしまった。
- **解決方法**:
  - `disablePointerDismissal` のデフォルトを base-ui の default (false) に戻す
  - whitelist → ブロックリスト方式に切替: `BLOCKED_CLOSE_REASONS = { focus-out, close-watcher }` のみ明示的にブロック。それ以外 (outside-press / escape-key / close-press / trigger-press / imperative-action / none) は全部通過
  - `eventDetails.cancel()` は引き続きブロック時に呼ぶ (base-ui の内部 state 更新を止めるため)
- **再発防止**:
  - **「原因不明 = 強力なロックを掛ける」をしない**。「キーボードで閉じる」現象に対して `disablePointerDismissal` を切るのは因果が繋がっていない (pointer ≠ keyboard)。症状と原因が一致するまで根拠なしに防御を増やさない
  - **defaults はライブラリの defaults に近づける**: 上書きデフォルトを増やすほど予期せぬ場所で挙動が変わる。base-ui の default を尊重し、必要な箇所だけ呼び出し側で override する
  - **regression テスト**: 「外クリックで閉じる」「ESC で閉じる」「× ボタンで閉じる」「Cancel で閉じる」など、基本動作は手動で確認するチェックリストを作る

---
## ダッシュボード「社員進捗一覧」と閲覧レポートで遵守事項カウントが食い違う (+1)

- **発生日**: 2026-05-20
- **発生箇所**: `components/admin/ReportMatrix.tsx`（閲覧レポート）/ `employee_progress` view（migration 185）/ `get_my_subordinate_progress` RPC（migration 187）
- **フェーズ**: 本番運用中
- **エラー内容**: admin ダッシュボードの遵守事項達成数（例 49）と閲覧レポートの既読セル数（例 50）がズレる。deaf-ic 実データで 3 名（濱田/田中/笠江）に gap=+1
- **原因**: ダッシュボード（185/187）は compliance を `ca.document_updated_at = cd.updated_at` で「現バージョンの ack のみ」カウント = 書類編集後の旧 ack は外れる（仕様どおり正しい）。一方、閲覧レポートは `compliance_view_logs` に 1 行でもあれば「✓既読」で**バージョン概念がゼロ**。書類編集で `updated_at` が進むと、ダッシュボードからは外れるが view_log は残り続けるため、レポートだけ +1 多く出る。真因はレポート側（view_logs 集計）にバージョン判定が無いこと。
- **解決方法**: content-version-tracking 機能（`docs/features/content-version-tracking.md`、migration 188/189）で 4 カテゴリすべてに版基準日時を持たせ、レポートもダッシュボードも「現版閲覧 = `view_log.viewed_at >= 版基準日時`」の同一ルールで判定するよう統一。ReportMatrix は「現版/旧版/未読」3-way 表示に。
- **再発防止**:
  - 「2 つの画面が同じ数字を出すべき」なら**集計の元データと述語を 1 つに統一する**（employee_progress / get_my_subordinate_progress / ReportMatrix が同じ「現版閲覧」述語を使う設計に）
  - 新しい「閲覧/完了」テーブルを足すときは**バージョン（編集日時）との関係を最初に設計する**。append-only ログにバージョン列が無いと後から整合が取れない
  - どちらの画面を「正」とするか仕様判断が割れる修正は、実装前にユーザーへ確認する

---
## 招待受諾ページで「パスワード設定に失敗しました / Auth session missing!」が間欠発生

- **発生日**: 2026-05-21
- **発生箇所**: `app/(auth)/invite/accept/page.tsx` `handleSetPassword` → `supabase.auth.updateUser({ password })`。真因は `lib/supabase/client.ts`
- **フェーズ**: 運用中バグ修正（staffbase で顕在化 → deaf-ic も同一構造のため予防同期）
- **エラー内容**: 招待リンクから初回パスワード設定フォームに到達し、パスワードを入力して送信すると `updateUser` が `AuthSessionMissingError: Auth session missing!` を返す。`handleAuth` の `setSession` 成功・フォーム表示までは正常で、送信時に**間欠的**に失敗する（再現で fail / pass の両方を観測）。
- **原因**:
  - `@supabase/ssr` の `createBrowserClient` は `flowType` を `'pkce'` に**固定**する（`createBrowserClient.js` で `flowType:"pkce"` をハード代入。オプションでは変更不可）。
  - 招待 / 再設定リンクは `admin.generateLink({ type:'recovery' })` 由来。Supabase の `/auth/v1/verify` は PKCE challenge を持たないこのリンクを **implicit grant のハッシュ**（`#access_token=...&refresh_token=...&type=recovery`）でリダイレクトする（`?code=` ではない）。
  - クライアントの `detectSessionInUrl`（`createBrowserClient` 既定 true）が有効なため、初期化時に SDK が `_getSessionFromURL` でこのハッシュを処理しようとし、`flowType==='pkce'` と implicit URL の不一致を検出して例外を throw する（`@supabase/auth-js` `GoTrueClient`）。SDK 側のセッション確立は失敗する。
  - ページ側は `handleAuth` で手動 `setSession`（ハッシュ）/ `exchangeCodeForSession`（code）するフォールバックを持つが、**SDK の（壊れた）自動検出機構と手動ハンドラが同一クライアント上で競合**し、`updateUser` 時にセッションを読めず "Auth session missing!" が間欠発生する。**真因は「flowType:pkce 固定」と「implicit ハッシュ招待リンク」の不整合 + 二重処理の競合**。
- **解決方法**: `lib/supabase/client.ts` の `createBrowserClient` に `{ auth: { detectSessionInUrl: false } }` を渡し、SDK の URL 自動検出を無効化（`createBrowserClient.js` は `detectSessionInUrl` を `options?.auth?.detectSessionInUrl ?? isBrowser()` で読むため、`false` 指定が確実に効く）。callback ページ（`invite/accept`, `reset-password/confirm`）は元から URL を自前解析して `setSession` / `exchangeCodeForSession` する設計なので、自動検出を切れば手動ハンドラが唯一かつ決定的な経路になり競合が消える。`flowType` は上書き不可のため `detectSessionInUrl` 無効化が取り得る最小修正。
- **再発防止**:
  - `lib/supabase/client.ts` のコメントに理由を明記（「不要そう」と削除されると再発するため）。
  - 招待 / 再設定リンクは `admin.generateLink` 由来 = 常に implicit ハッシュ。callback ページで URL を自前処理する設計を維持し、SDK の `detectSessionInUrl` を再有効化しないこと。
  - deaf-ic は dev-name-mask 分岐があるため、`createClient` の両分岐（mask ON/OFF）に `auth` オプションが必ず入るよう `authOptions` を共通化して併合。

---
## 日次出力モバイルで送迎ブロックが1列縦積みにならず3列のまま（記録漏れ補完）

- **発生日**: 2026-05-19
- **発生箇所**: `components/shift/DailyOutputFull.tsx` の `@media screen and (max-width:1023px)` + `ThreeColGrid`
- **フェーズ**: モバイル対応バグ修正
- **エラー内容**: 日次出力ページをモバイル幅で見ると送迎ブロックが1列縦積みにならず3列レイアウトのまま見切れる。先行コミット 7ea9679 の mobile fix で直したつもりが直っていなかった。
- **原因**: 7ea9679 で `@media(max-width:1023px)` に `.transport-three-col { grid-template-columns:1fr }` を入れたが、React 側で各ブロックに `style={{ gridColumn: pos.col, gridRow: pos.row }}` を **inline 指定**。inline style は CSS より優先されるため子は依然 col2/col3 を要求 → ブラウザが implicit column を生成し、結局3列のまま。CSS だけ直す mobile fix が不完全だった。
- **解決方法**: モバイル media query に `.transport-three-col > div { grid-column:1 !important; grid-row:auto !important }` を追加し、inline 指定を `!important` で打ち消して真の1列縦積みに。
- **再発防止**: CSS の `grid-template-columns` を変えても、子要素の inline `gridColumn`/`gridRow` が残っていると implicit column で打ち消される。レイアウトをレスポンシブに切り替えるなら**子の明示配置も一緒にリセット**する。

---
## モーダルが開いた瞬間に下端までスクロールした状態で表示される（記録漏れ補完）

- **発生日**: 2026-05-19
- **発生箇所**: `components/ui/dialog.tsx` の `DialogContent`（base-ui Dialog Popup）
- **フェーズ**: UX 改善（モーダル初期表示位置）
- **エラー内容**: 長いモーダル（遵守事項詳細など）を開くと、最上部でなく下端付近にスクロールした状態で表示される。
- **原因**: base-ui Dialog Popup の `initialFocus` default が「最初の tabbable element」。長いモーダルで内部ボタン（✓確認しました等）が最初の tabbable になると、ブラウザ標準の `scrollIntoView` でそのボタン位置までスクロールされ「開いた瞬間に下端表示」になる。
- **解決方法**: `initialFocus={popupRef}` で popup 自身（最上部・常に viewport 内）に focus を向ける。focus 対象が viewport 内なら `scrollIntoView` が発火しない。`useEffect` で scrollTop=0 を後追いで当てる場当たり対応は不安定なため撤廃し、focus を最初から正しい場所へ向ける根本対応に切替。
- **再発防止**: base-ui Popup の `initialFocus` default は first tabbable。長いモーダルでは内部要素への auto-focus が `scrollIntoView` を誘発する。`initialFocus` を popup ref に固定する。

---
## 研修モバイルで Drive 動画が見切れ + タップ無反応（記録漏れ補完）

- **発生日**: 2026-05-19
- **発生箇所**: `components/admin/BlockRenderer.tsx` の Drive 動画ブロック / `app/(employee)/my/trainings/page.tsx`
- **フェーズ**: モバイル対応バグ修正
- **エラー内容**: 研修のモバイル表示で Google Drive 動画が見切れる + タップしても反応しない。
- **原因**: Drive `/preview` iframe はモバイルで Drive 側 UI バーが画面を占有 + cross-origin player の touch event 伝播が不安定。サイズ調整だけでは解決不可。
- **解決方法**: 動画を `<video>` ネイティブ要素 + 自前 streaming proxy（`app/api/drive-video/[fileId]/route.ts` で drive.usercontent から Range ヘッダをフォワード + 206 Partial Content）で再生。iframe を廃止。`aspect-ratio` 16:9 + `object-contain`。
- **再発防止**: cross-origin の埋め込み player はモバイルで touch / レイアウトが不安定。動画は可能な限りネイティブ `<video>` + 自前 proxy で配信する。
- **【2026-05-26 補足 — 本欄の方針は逆転した】**: 上の解決方法（自前 streaming proxy）は **Vercel Hobby の Fast Origin Transfer 10 GB を直撃する構造**であり、本ファイル冒頭「Drive 動画が読込 10 秒以上で離脱増」（2026-05-26）で**完全撤去**された。現状の正しい解決方針は「**▶ サムネカードから Drive を新規タブで開く**（Drive 側 player に責任委譲）」。再発防止は `docs/constraints.md` §1 を参照。本エントリだけ読んで「`<video>`+proxy で配信する」を採用しないこと。

---
## 非公開保存なのに「2時間後にメール通知されます」toast が出る（記録漏れ補完）

- **発生日**: 2026-05-19
- **発生箇所**: `app/(admin)/admin/{announcements,compliance,manuals}/page.tsx` の `handleSave` edit 分岐
- **フェーズ**: 本番運用中バグ修正
- **エラー内容**: 4機能を「非公開」で保存しても「2時間後に対象社員へメール通知されます」toast が表示される。実メールは dispatcher 側で `is_published=false` を見て cancel するため送信はされないが、UX 上の嘘 + 無駄な queue 行作成があった。
- **原因**: admin 各ページの `handleSave` edit 分岐が `is_published` を無視して常に `enqueueNotification` +「送信されます」toast を実行していた。
- **解決方法**: `lib/notifications/queue.ts` に `enqueueOrCancelByPublished` helper を追加（`is_published=true` → enqueue / `false` → cancel）。3 admin ページの edit 分岐を helper 経由に。toast 文言も `is_published` で分岐（公開時のみ「通知されます」）。
- **再発防止**: 通知を伴う保存は `is_published` を必ず判定。enqueue/toast を「公開状態ゲートのヘルパー1本」に集約し、ページごとの分岐コピペを排除する。

---
## /my/manuals がビルド時に useSearchParams CSR bailout エラー（記録漏れ補完）

- **発生日**: 2026-05-18 頃
- **発生箇所**: `app/(employee)/my/manuals/page.tsx`
- **フェーズ**: ビルドエラー修正
- **エラー内容**: 本番ビルドで `useSearchParams()` の CSR bailout エラーにより `/my/manuals` のプリレンダーが失敗。
- **原因**: `useSearchParams()` を使うコンポーネントを `Suspense` でラップしていなかった。Next.js App Router は `useSearchParams` をクライアント境界として `Suspense` boundary を要求する。
- **解決方法**: `/my/manuals` を `Suspense` でラップ。
- **再発防止**: `useSearchParams()` を使うページ/コンポーネントは必ず `Suspense` boundary で包む。ビルド（`npm run build`）を push 前に通す運用で早期検出する。

---
## ダッシュボード社員進捗バッジが「3/2」(分子>分母) を表示する (audience 非対称)

- **発生日**: 2026-05-23
- **発生箇所**: `supabase/migrations/189_progress_version_aware.sql` の `employee_progress` view + `get_my_subordinate_progress` RPC の 4 カテゴリ count サブクエリ / 表示側は `app/(manager)/mgr/dashboard/page.tsx:398` と `components/admin/ProgressDashboard.tsx:259` の `<ProgressBadge current={r.announcements_read} total={rowTotals.announcements}/>`
- **フェーズ**: 本番運用中バグ修正 (root-cause-fix)
- **エラー内容**: 事業所「🎨パレット」の 3 名 (岸部敬子・禹浩鉉・鈴木巳鈴) で、お知らせ既読バッジが `3/2` (分子 3 が分母 2 を超過)。閲覧レポートでは同社員が「2 件・各 1 回既読」と正しく表示されており、ダッシュボードだけが食い違っていた。
- **原因 (真因)**: ダッシュボード分子 (migration 189 の view + RPC の `announcements_read` / `manuals_read` / `trainings_passed` / `compliance_done`) が **`is_published + tenant 一致 + 版/合格条件` だけで数え、社員ごとの配信対象 (audience: `target_type / target_facility_ids / target_position_ids`) を見ていなかった**。一方、ダッシュボード分母 (`publishedTotalsByEmployee`) と閲覧レポート (`ReportMatrix` / `/api/reports`) は `lib/multi-facility.ts::isItemInAudience` で audience フィルタ済み。この非対称により、社員が「配信対象外だが過去に閲覧した」アイテム (例: 別事業所宛のお知らせを過去閲覧) を持つと分子 > 分母 になる。実データ: 「おもちゃの消毒」(`target_type='facility'`, 対象=パレット以外の別事業所) の view_log が 3 名分残っており、それを分子だけが拾っていた。187 が塞いだ「非公開化」「旧版」由来の分母超えとは**別軸 (audience 軸)** の同パターン。
- **解決方法**: migration 190 (`190_progress_audience_aware.sql`) で `employee_progress` view + `get_my_subordinate_progress` RPC の 4 カテゴリ count + `last_*_at` 全てに audience フィルタを追加。判定は新規 SQL 関数 `public.item_in_audience(target_type, target_facility_ids, target_position_ids, emp_facility_ids, emp_position_id)` に集約 (`lib/multi-facility.ts::isItemInAudience` と同一ロジック)。RETURNS TABLE / view 列構造は不変なので UI ファイル変更なし。両 DB (deaf-ic / staffbase) に適用。deaf-ic で 3 名が `3/2 → 2/2` に修正されたことを実データ確認、staffbase は影響社員 0 で preventive 適用。
- **再発防止**: audience 判定を SQL 関数 `item_in_audience` 1 本に集約 (view / RPC の 8 サブクエリ + 4 last_*_at が全て同関数を呼ぶ。インラインコピー禁止)。`lib/multi-facility.ts::isItemInAudience` と SQL `item_in_audience` は**常に同義に保つ** (どちらか変えたら他方も変える)。**「ダッシュボード分子と分母・閲覧レポートが構造的に一致しているか」を新集計追加時のチェックポイントにし、audience 軸を最初に揃える。**

---
## 管理者「自己紹介・働き方」タブに 3 項目表示漏れ + AI 診断に英語 enum 値混入

- **発生日**: 2026-05-26 (ORIGAMI-GRP-staffbase で発覚、本家系の deaf-ic にも同根バグありで移植)
- **発生箇所**:
  - 表示漏れ: `app/(admin)/admin/employees/[id]/page.tsx` の自己紹介タブ
  - AI 英語: `app/api/ai/{team-compat,personality,strengths,culture-fit}/route.ts`
- **エラー内容**:
  1. 社員側 `ProfileSection2Intro.tsx` で入力できる `efforts_focused_on` / `how_others_describe` / `values_and_motivation` の 3 項目が **管理者の社員詳細「自己紹介・働き方」タブで表示されない** (社員は入力できる、DB には保存される、マネージャー側 `SubordinateDetail.tsx` では表示済)。
  2. AI 診断の出力テキストに英語の enum 値 (「context重視・organized相談」「conclusion重視」等) がそのまま混入していた。
- **原因**:
  1. **表示漏れ**: 管理者画面の自己紹介タブで current_duties / past_duties までしか JSX に書かれておらず、3 項目分の `<div>` がそもそも存在しなかった。社員側フォームとマネージャー側表示には反映されたが管理者側だけ漏れた初期実装の取りこぼし。
  2. **AI 英語混入**: 4 つの AI 診断 API ルートが employees 行の enum カラム (`comm_conclusion_vs_context = 'context'`, `comm_consult_timing = 'organized'`, `work_style_clear_vs_autonomy = 'autonomy'` 等) を `JSON.stringify` で**生のまま AI に渡していた**。AI は受け取った英語値をそのまま文章に転記するため、出力テキスト全体に英語が混じる。既存の `profileOptionLabel` (lib/profile-options.ts) は画面表示には使っていたが、AI 渡し側では使われていなかった。
- **解決方法**:
  1. `app/(admin)/admin/employees/[id]/page.tsx` 自己紹介タブの current_duties / past_duties セクションの直後に 3 項目表示の `<div>` を追加 (deaf-ic は `brand-*` クラス名で適用)。
  2. **`lib/diagnosis-data.ts` を新規追加** — `buildAiInputData(employee, fields)` ヘルパーが enum カラムだけ `profileOptionLabel` 経由で日本語ラベルに変換 + その他 text カラムはそのまま渡す。4 ルートすべてで `buildAiInputData` を呼ぶように置換。
  3. 既存保存済 `ai_diagnoses` 行 (英語混じり) は**そのまま** (再診断時に上書き)。
- **再発防止**:
  - DB の enum 値を**外部に渡す前は必ずラベル変換**を通す。`profile-options.ts` のラベル定義が「単一の真実源」なので、画面側だけでなく AI / メール / Webhook 等の出力側でも使う。
  - 社員側フォームに新フィールドを追加したら、**管理者画面・マネージャー画面・AI 診断 (DIAGNOSIS_FIELDS) の 4 経路を必ず横断確認**。今回は 1 経路 (管理者画面) が漏れていた。
  - 3 リポ (本家 diletto / ORIGAMI / deaf-ic) 共通の構造的バグ。ORIGAMI で先に発覚した経緯なので、本家系でも同じ修正を移植済。
- **関連**: docs/reference-map.md 末尾 / lib/diagnosis-data.ts (新規) / lib/profile-options.ts (既存)
---
## manager「個別送信メッセージ」新規スレッド作成で RLS 違反 (diletto で発覚 / 観測コードを deaf-ic にも移植)

- **発生日**: 2026-05-26 (diletto で報告、deaf-ic は同一コードベースのため予防的に観測コード移植)
- **発生箇所**: `components/messages/MessagesView.tsx` の `NewThreadDialog.submit()` step 1 (`message_threads.insert`)
- **状態**: **deaf-ic では未報告 / diletto で未解決**。両リポは同じ messaging 実装なので deaf-ic でも同根が再現する可能性ありとして観測コードを先回り移植。
- **diletto 側の事実関係 (詳細は diletto repo の同日 error-log 参照)**:
  - migration 176/177/178 (message_threads_insert / thread_members_insert / attachments link_url) は本番 DB に適用済
  - `message_threads_insert` policy は `tenant_id` 一致だけの単純チェック → manager でも通る構造
  - エラーは「`new row violates row-level security policy for table "message_threads"`」(報告された画面表示の前後)
  - 真因は未確定 (`me.tenant_id` undefined / `auth.uid()` セッション失効 / cache 残存 のいずれか)
- **暫定対処 (本コミットで実施)**:
  - `MessagesView.submit()` の各 step に**観測ログを追加** (diletto と同内容): 開始時に `[messages submit] start` で `{authUid, meId, meTenantId, meRole, recipients}` を `console.info`、各 step 失敗時に `console.error` でエラー code/message/details/hint をフル出力
  - 次回再現時に F12 Console をコピペすれば真因をほぼ確定できる
- **次回再現時のチェック手順**:
  1. F12 → Console
  2. 新規スレッド作成 → 送信
  3. `[messages submit] start` の object → authUid が null → 再ログイン / `me.tenant_id` 空 → loadMe 調査
  4. `[messages submit] step1 ... failed` の error フィールド → policy 評価詳細
  5. Network タブで `POST /rest/v1/message_threads` の Request/Response body
- **再発防止**:
  - 観測コードを残し、再現時の真因確定後に修正
  - root-cause-fix「再現できていないのに修正を書かない」原則を遵守
- **関連**: docs/reference-map.md 末尾 / components/messages/MessagesView.tsx (観測コード)
---
*(以降、新規エラーがあれば追記)*
