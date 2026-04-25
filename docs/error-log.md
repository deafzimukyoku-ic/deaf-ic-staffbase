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
*(以降、新規エラーがあれば追記)*
