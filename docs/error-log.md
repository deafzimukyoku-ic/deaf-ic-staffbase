# error-log.md — deaf-ic エラーログ

実装中に発生したエラーと解決方法を記録する学習ログ。
**解決したら作業完了前に必ず記録。同種エラー発生時はまずこのファイルを参照すること。**

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
*(以降、新規エラーがあれば追記)*
