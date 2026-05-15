# reference-map.md — deaf-ic 参照台帳

プロジェクト内の「DBテーブル・カラム・定数・型・ロール・マイグレーション・コンポーネント」がどのファイルで参照されているかを記録する台帳。
**新規ファイル作成時・既存編集時は必ず更新すること。更新忘れ = 作業未完了。**

---

## 0. 適用済みマイグレーション（最新）

| 番号 | ファイル | 内容 | 適用済 |
|---|---|---|---|
| 001〜047 | staffbase 既存（all_migrations_combined.sql） | 初期スキーマ | ✅ |
| 090 | 090_drop_stripe_plan.sql | Stripe/plan削除、ロール3段階化 | ✅ |
| 091 | 091_manuals.sql | 業務マニュアル + manual_reads + categories.type='manual' | ✅ |
| 092 | 092_sort_order.sql | 4テーブルに sort_order 追加 + backfill | ✅ |
| 093 | 093_content_blocks.sql | content_blocks jsonb + trainings.body | ✅ |
| 100 | 100_shift_core.sql | shift-maker テーブル群（facility対応） | ✅ |
| 101 | 101_shift_rls.sql | shift系 RLS（facility単位） | ✅ |
| 102 | 102_shift_rpcs.sql | update_schedule_entry_attendance 等 RPC | ✅ |
| 103 | 103_employees_shift_fields.sql | employees に shift固有カラム + facility_shift_settings | ✅ |
| 104 | 104_shift_settings_extend.sql | facility_shift_settings 拡張 + employees.qualifications | ✅ |
| 105 | 105_schedule_entries_methods.sql | schedule_entries: pickup/dropoff_method/note + leave 追加 | ✅ |
| 106 | 106_notification_queue_shift.sql | notification_queue に shift_ready/shift_publish + facility_id/meta カラム | ✅ |
| 107 | 107_employee_ready_visibility.sql | employee の RLS を ready/published 両方閲覧可に拡張（案Z 仮シフト方式） | ✅ |
| 108 | 108_updated_by.sql | announcements/compliance_documents/trainings/manuals に updated_by カラム追加 | ✅ |
| 109 | 109_notification_queue_manual.sql | notification_queue.content_type に 'manual' 追加 | ✅ |
| 110 | 110_employee_progress_manuals.sql | employee_progress ビューに manuals_read 追加 | ✅ |
| 111 | 111_view_logs.sql | compliance/training/announcement/manual の view_logs ×4（何回見たか・いつ見たか） | ✅ |
| 112 | 112_transport_employee_ids.sql | transport_assignments: pickup/dropoff_staff_ids → pickup/dropoff_employee_ids 改名 | ✅ |
| 113 | 113_child_display_order_memory.sql | 児童 DnD 並び順記憶テーブル（slot_signature, child_id, display_order） | ✅ |
| 114 | 114_employees_qualifications_array_fix.sql | employees.qualifications を text → text[] に変換（104 が `add column if not exists` で skip された型ズレを是正） | ✅ |
| 115 | 115_remove_departments_and_position_role.sql | (A) departments / employee_departments / manager_departments 完全削除 + employees.department drop / (B) positions.system_role + 同期トリガー削除（役職→ロール自動連動を切断） | 🆕 未適用 |
| 116 | 116_facility_core_time_and_meta.sql | (A) facility_shift_settings.core_start_time / core_end_time（コアタイム事業所別設定） / (B) facilities に display_order / shift_enabled / transport_enabled 追加（並び順 + シフト/送迎 ON/OFF） | 🆕 未適用 |
| 130 | 130_employee_facilities.sql | **複数事業所所属（兼任）対応**。employee_facilities テーブル（兼任先のみ）+ ヘルパー関数 `get_my_facility_ids()` / `get_my_managed_facility_ids()` / `employee_belongs_to_facility(emp,fac)` + 主所属＝兼任の重複防止トリガ × 2 | 🆕 未適用 |
| 131 | 131_multi_facility_rls.sql | RLS 大改修：facility-only テーブル (children/schedule_entries/events/billing/facility_shift_settings/transport_assignments) + employee-level cross-facility テーブル (shift_requests/shift_assignments/shift_change_requests) で兼任を考慮。manager の管轄施設は `get_my_managed_facility_ids()` ベース。`employee_in_my_managed_facilities()` 追加 + `get_manager_subordinate_ids()` 兼任対応に拡張 | 🆕 未適用 |
| 156 | 156_get_my_subordinate_progress_rpc.sql | **`get_my_subordinate_progress(p_facility_id uuid)` RPC 新設**（SECURITY DEFINER）。/mgr/dashboard の部下達成率が全件 0% になる問題の修正。employee_progress（security_invoker ビュー）+ submission 系テーブル直読みは manager の RLS で 0 件になるため、RPC で部下ごとの完了件数 + 各カテゴリ最終完了日時を返す。migration 148/153 の ambiguous 対策（alias + `AS fid`）踏襲 | 🆕 未適用 |

---

## 0.12 /mgr/dashboard 部下進捗修正 + プロフィール選択肢の真実源化（2026-05-15）

### ④ /mgr/dashboard 達成率が全件 0%
- **原因**: `employee_progress` は `security_invoker=true` ビュー（migration 013/046/110）。内部 `count(*)` サブクエリが呼び出し元（manager）の RLS で実行されるが、manager は subordinate の `document_submissions` / `compliance_acknowledgments` / `announcement_reads` / `manual_reads` / `employees` 行を読む RLS を持たない（migration 144 で employees の manager SELECT を追加 → 145 で「全員ログアウト」発生のためロールバック。以降 146〜149 は SECURITY DEFINER RPC 方式）。
- **修正**: migration 156 で `get_my_subordinate_progress` RPC を新設し、`app/(manager)/mgr/dashboard/page.tsx` を `employee_progress` 直読み + 12 直クエリ → RPC 1 本 + コンテンツ件数クエリ 5 本に書き換え。/mgr/subordinates と同じ設計に統一。RLS は一切変更しない。
- コンテンツ件数（`document_templates` / `compliance_documents` / `trainings` / `announcements` / `manuals` の count）は「tenant members can read」ポリシーで manager も読めるため直クエリのまま。

### ⑤ /mgr/subordinates/[id] の働き方・コミュ傾向が英語生値表示
- **原因**: 表示側 `components/manager/SubordinateDetail.tsx` が `work_style_*` / `comm_*` / `multitask_ability` / `detail_orientation` / `meeting_behavior` の DB 値（solo / proactive 等）をそのまま表示。日本語ラベルは入力フォーム（`ProfileSection3WorkStyle` / `ProfileSection4Comm`）にローカル定義されていたが共有されていなかった（admin 側 `WORK_STYLE_LABELS` / `COMM_LABELS` も別コピーで一部 stale）。
- **修正**: `lib/profile-options.ts` を単一の真実源として新設。入力フォーム 2 つを共有定義（`WORK_STYLE_FIELDS` / `COMM_SELECT_FIELDS`）import に移行。`SubordinateDetail` は `profileOptionLabel(fieldKey, value)` 経由で日本語化。

### 新規ファイル
| ファイル | 内容 |
|---|---|
| `supabase/migrations/156_get_my_subordinate_progress_rpc.sql` | `get_my_subordinate_progress` RPC |
| `lib/profile-options.ts` | 働き方 6 + コミュ 5 項目の選択肢定義（単一真実源）+ `profileOptionLabel()` ヘルパ |

### 編集ファイル
| ファイル | 変更 |
|---|---|
| `app/(manager)/mgr/dashboard/page.tsx` | 部下進捗取得を `get_my_subordinate_progress` RPC 経由に。`SubordinateProgressRow` 型追加 |
| `components/employee/ProfileSection3WorkStyle.tsx` | ローカル `selectFields` 削除 → `lib/profile-options` の `WORK_STYLE_FIELDS` import |
| `components/employee/ProfileSection4Comm.tsx` | ローカル `selectFields` 削除 → `COMM_SELECT_FIELDS` import |
| `components/manager/SubordinateDetail.tsx` | 働き方 6 + コミュ 5 の InfoRow を `profileOptionLabel()` 経由に |

### 参照テーブル・RPC
- RPC: `get_my_subordinate_progress(p_facility_id uuid)` — 参照テーブル `employees` / `employee_facilities` / `manager_facilities` / `document_submissions` / `compliance_acknowledgments` / `training_submissions` / `announcement_reads` / `manual_reads`

---

## 0.09 計画 A/B + 施設順 ON/OFF + sticky 透けバグ修正（2026-04-25）

### sticky 透けバグ（計画 A）
- `app/globals.css` に **`--accent-pale-solid` / `--red-pale-solid` / `--gold-pale-solid` / `--green-pale-solid` を新規定義**
- 元々 hex 不透明色だったが、shift-puzzle 移植コードが `-solid` サフィックスで参照していたため未定義 → transparent 扱い → スクロール時に下層が透けるバグ。1 行修正で全画面解消

### 施設絵文字運用（C案）
- DB 変更なし。事業所名の先頭に絵文字を入れる運用（例: 「🌸 パステル」）
- 全画面の hard-coded `🏢 {f.name}` prefix を削除（admin/manager layout / access-matrix / ChildrenManager / ProgressDashboard）

### シフト表サイドバー新4行構成（計画 B）
| 行 | ロジック |
|---|---|
| 出勤者数 | 既存（assignment_type='normal' の重複ない employee_id 数） |
| 有資格者基準 | コアタイム重複の有資格者数 ≥ `min_qualified_staff` → ✓/✗ |
| 提供時間内の有資格者 | コアタイム中の有資格者最小人数（30分刻み）。`min_qualified_staff` 未満で赤 |
| 余力 | 児童数 ÷ コアタイム出勤職員数。<3 緑 / 3〜4 黄 / **≥4 赤+⚠** |

### 関連ファイル
- `lib/logic/qualifiedCoverage.ts`: `coreStartTime/coreEndTime` 引数追加、`coreStaffCount` を `CoverageResult` に追加
- `components/shift/ShiftFull.tsx`: `facility_shift_settings` から `core_start_time / core_end_time / min_qualified_staff` 取得 → grid に渡す
- `components/shift/ShiftGridFull.tsx`: 3 行 → 4 行構成。新指標で再描画
- `components/shift/FacilitySettingsFull.tsx`: コアタイム編集 UI 追加

### 施設並び順 + ON/OFF（②）
- `app/(admin)/layout.tsx`: facility 取得を `display_order` ASC + `shift_enabled=true` 絞り。`transport_enabled=false` の facility 選択中は nav から「送迎表」「週次送迎」を非表示。`useMemo` で `transportEnabled` 算出
- `app/(manager)/layout.tsx`: 同様に display_order ソート + shift_enabled フィルタ
- `app/(admin)/admin/settings/page.tsx`: 施設行をドラッグ&ドロップ並び替え（@dnd-kit）+ 「シフト」「送迎」2 トグル
- `lib/types.ts`: `Facility` に `display_order? / shift_enabled? / transport_enabled?` 追加（optional で互換維持）

### シフトモード初期値の修正（①）
- 旧: localStorage 値があればそれ、なければ `list[0]`
- 新: 1) localStorage 値がアクセス可能リストに含まれるなら維持 / 2) `employees.facility_id` を優先 / 3) フォールバックで `list[0]`

---

## 0.11 認証フロー堅牢化 — Phase 68（2026-04-30）

### 修正内容（招待 / ログイン / パスワードリセット）

**新規ファイル:**
- `app/(auth)/reset-password/confirm/page.tsx` — パスワードリセット完了 UI（PKCE code 交換 + 新パスワード入力）

**編集ファイル:**
- `app/(auth)/reset-password/page.tsx` — `redirectTo` を `/reset-password/confirm` に変更 + 1h 失効注記
- `app/(auth)/login/page.tsx` — `/auth/callback` から渡される `?error=missing_code|invalid_code` を toast 表示し URL から削除
- `app/(auth)/invite/accept/page.tsx` — 招待リンク失効時のエラー画面に「約1時間で失効」注記を追加
- `app/(admin)/admin/employees/new/page.tsx` — アプリ権限（admin/manager/employee）セレクタ + manager 兼任先選択 chip UI を追加 / 招待リンク有効期限の注記を追加
- `app/api/employees/invite/route.ts` — `position_id` を受け取り `positions.name` を `employees.position`(text) に保存 / employees insert 失敗時に新規 auth.users を rollback 削除（既存ユーザー再利用ケースは消さない）/ manager_facilities insert 失敗を warning として返す / `me` 取得を `.maybeSingle()` 化
- `middleware.ts` — `DEV_SKIP_AUTH` を `NODE_ENV !== 'production'` でガード / employees.role 取得を `.single()` → `.maybeSingle()` 化（3 箇所）/ `/reset-password/confirm` を auto-redirect 除外に追加

### 修正したバグ

| 重要度 | 内容 |
|---|---|
| 🔥 致命 | パスワードリセット完了 UI が存在せず、メールリンクから `/login` に飛んでログイン状態になるだけでパスワード再設定不能だった |
| 🔥 silent | 新規社員追加 UI で役職を選んでも API がフィールドを destructure しておらず保存されない（黙って消える） |
| 🔥 UI 欠如 | 新規社員追加 UI に role 選択が無く、admin/manager 招待は access-matrix からしかできなかった |
| ⚠ | `DEV_SKIP_AUTH=1` が本番に漏れた場合に全認証が無効化されるリスク |
| ⚠ | middleware の `.single()` で RLS 不整合時に 500 を返すリスク |
| ⚠ | manager_facilities insert 失敗が `console.error` のみで握り潰されていた |
| ⚠ | employees insert 失敗時に orphan auth.users が残る非トランザクション性 |
| 改善 | リンク有効期限（招待 / リセット = 約 1h）が UI に明記されておらず、期限切れ時にユーザーが混乱 |
| 改善 | `/auth/callback` のエラーリダイレクト時に `?error=` の文言が表示されない |

### スコープ外（今回触らない）

- Supabase Auth メールテンプレート（Dashboard 側）— `docs/email-templates.md` に定義済 / `redirectTo` で十分制御可能
- `auth.users` と `employees.email` の二重保護トリガ — migration 138 で撤廃済（アプリ層保護に統一）
- ~~退職者の auth.users 無効化 — 別フェーズ~~ → **2026-04-30 実装済**（下記 Phase D 参照）
- MFA / SSO — スコープ外（CLAUDE.md §13）

---

## 0.10.5 在職/退職切替 + 退職者ログイン遮断 — Phase D (2026-04-30)

### 目的
- 退職処理は片道だった（`status='retired'` にする UI のみ）→ 在職に戻すボタンを追加
- 退職者は `employees` 一覧クエリから外れるだけで、Auth セッションが生きていれば本人の `/my/*` を触れる状態 → 完全遮断

### 実装
- 新規: [`app/api/employees/[id]/status/route.ts`](../app/api/employees/[id]/status/route.ts)
  - admin のみ。同テナントのみ。自分自身を retire 不可
  - `action='retire'` → `employees.status='retired'` + `auth.admin.updateUserById(authId, { ban_duration: '876000h' })`
  - `action='reactivate'` → `status='active'`, `retirement_date=null`, `retirement_reason=null` + `ban_duration: 'none'`
  - Auth BAN 失敗は warning で返す（middleware が二重防御するため運用続行可）
- 更新: [`app/(admin)/admin/employees/[id]/page.tsx`](../app/(admin)/admin/employees/[id]/page.tsx)
  - `handleRetire` を API 経由に置換、`handleReactivate` 追加
  - status==='retired' のとき「在職に戻す」ボタン + ダイアログ
- 更新: [`middleware.ts`](../middleware.ts)
  - `employees.status` も SELECT。`retired` なら `supabase.auth.signOut()` + `/login?error=retired` リダイレクト（public path 自動 redirect ブロック + 保護ルート両方で）
- 更新: [`app/(auth)/login/page.tsx`](../app/(auth)/login/page.tsx)
  - `?error=retired` 時のトーストメッセージ追加
  - `signInWithPassword` 成功直後に `employees.status` を確認、retired なら即 `signOut` + エラー表示（Auth BAN レース対策）

### 三層防御
| 層 | 効果 |
|---|---|
| Supabase Auth `ban_duration` | ログイン自体が Supabase 側で 401。既存 access token も refresh 時に失効 |
| middleware retired チェック | 既存セッションの保護ルート侵入を遮断（API ルートは matcher 外なので注意） |
| login ページ status チェック | BAN 適用に失敗していた場合の最終防御 |

### 注意
- 既存の `status='retired'` 社員は **Auth BAN されていない**。reactivate→retire を踏むか、本人が一度 `/login` を踏んだ時点で middleware が signOut + redirect する
- middleware の matcher は `api/` を除外しているため、API 経路は各 API ハンドラ側で必要に応じて status チェックを追加する余地あり（現状は `lib/auth/shift-api-helpers.ts` に未実装、別フェーズで検討）

---

---

## 0.10 複数事業所所属（兼任）対応 — Phase 67 (2026-04-30)

### 背景
NPO 4 事業所運用で複数施設をいったり来たりする職員が存在。`employees.facility_id` 単一前提では:
- 兼任先のお知らせ / 遵守事項 / 研修 / マニュアルが届かない（受信側 facility_id 単一比較のため）
- 兼任職員の休み希望を主所属でない側のマネージャーが見られない
- 兼任職員のシフトが「もう片方の施設のシフト表」に表示されず、二重アサイン事故の温床

### 設計
- `employees.facility_id` = 主所属（既存・残置）。給与・通勤手当・職員一覧の主表示の基準
- `employee_facilities (employee_id, facility_id)` = **兼任先のみ**（主所属は含めない）。重複は trigger で防ぐ
- ヘルパー関数 2 種:
  - `get_my_facility_ids()` = 主所属 ∪ 兼任先（employee 側コンテンツフィルタ・所属判定）
  - `get_my_managed_facility_ids()` = 主所属 ∪ `manager_facilities` 管轄（manager 側 RLS）
- `employee_in_my_managed_facilities(emp_id)` = 任意職員が自分の管轄施設に所属するか判定
- 副次効果: 既存の shift RLS は `manager_facilities` を見ていなかった bug が解消（manager が複数管轄施設を持つときシフト関連を読めるようになる）

### 「他施設勤務」表示 (UI のみ・スキーマ無変更)
A 施設で勤務時間を登録 → B 施設のシフト表に「A 勤務」と自動表示。
- 実装: ShiftFull が同 employee × 同月の `assignment_type='normal'` を他施設からも fetch → `crossFacilityWorkByCell` Map
- ShiftGridFull が cell の type='off' かつ cross データがあれば config.label の代わりに「○○ 勤務」を表示
- 兼任職員の名前横に「兼任」バッジ（primary_facility_id ≠ currentFacilityId のとき）

### マイグレーション
| 番号 | 内容 |
|---|---|
| 130 | `employee_facilities` テーブル + 3 ヘルパー関数 + 重複防止トリガ × 2（`employees.facility_id` 変更時に兼任側を delete / 兼任 INSERT 時に主と同じなら skip） |
| 131 | RLS 大改修：children/schedule_entries/shift_requests/shift_assignments/transport_assignments/shift_change_requests/facility_shift_settings/events/billing_summaries/billing_event_participations の manager ポリシーを `get_my_managed_facility_ids()` に置換。shift_assignments には manager の cross-facility SELECT 追加（B のシフト表で X の A 勤務を表示するため）。`get_manager_subordinate_ids()` を employee_facilities 兼任考慮に拡張 |

### 編集ファイル
| ファイル | 変更 |
|---|---|
| `lib/types.ts` | `Employee.additional_facility_ids?: string[]`（合成 prop）+ `EmployeeFacilityRow` 型追加 |
| `lib/multi-facility.ts` 🆕 | 4 ヘルパー: `fetchMyFacilityIds` / `facilityTargetsMatchMine` / `fetchFacilityMemberIds` / `fetchEmployeeIdsForFacilities` |
| `lib/auth/shift-api-helpers.ts` | manager は requestedFacilityId を managed set で検証。`scopedFacilityIds` 追加で API 側ハンドラが「自分の管轄全施設」を取得可能 |
| `app/(employee)/my/{compliance,announcements,trainings,manuals}/page.tsx` × 4 | フィルタを `target_facility_ids ∩ myFacilityIds` の有無に変更（兼任先の配信も届く） |
| `app/(admin)/admin/employees/[id]/page.tsx` | 「所属設定」カードに「兼任先」チップ + 追加セレクタ。主所属変更時にローカル state も dedupe |
| `app/(manager)/mgr/subordinates/page.tsx` | 部下取得を `fetchEmployeeIdsForFacilities` 経由に（兼任職員も部下として表示） |
| `components/shift/AdminRequestsView.tsx` | employees / shift_requests 取得を `memberIds` ベースに（兼任職員の他施設希望も両管理者に表示） |
| `components/shift/ShiftFull.tsx` | employees 取得を memberIds ベースに / 他施設の `normal` assignment を別 fetch して `crossFacilityWorkByCell` 構築 / 保存後に同職員・同日他施設重複を検出して toast 警告 (Phase 9) |
| `components/shift/ShiftGridFull.tsx` | `currentFacilityId` / `crossFacilityWorkByCell` props 追加 / 「兼任」バッジ + 「○○ 勤務」表示の rendering |

### スコープ外（決定）
- 二重アサインは保存ブロックせず警告のみ（運用判断を尊重）
- 応援マークの手動付与 UI は廃案（A 施設で勤務時間入力 → 自動的に B 表に表示の方が自然）
- 兼任職員の主所属切替は既存 facility 編集 UI で実施（trigger が自動で兼任側を dedupe）

---

## 0.08 権限マトリクス + 部署系完全削除（2026-04-25）

### 新規ファイル
| ファイル | 役割 |
|---|---|
| `app/(admin)/admin/access-matrix/page.tsx` | 管理者・マネージャーの施設アクセスをマトリクス編集 + 招待モーダル |
| `supabase/migrations/115_remove_departments_and_position_role.sql` | 部署系 4 テーブル/カラム削除 + positions.system_role + 同期トリガー削除 |

### 編集ファイル
| ファイル | 変更 |
|---|---|
| `app/api/employees/invite/route.ts` | role + manager_facility_ids を受け付け、bulk insert |
| `app/(admin)/layout.tsx` | shiftNav 「権限マトリクス」追加 |
| `lib/types.ts` | Department / EmployeeDepartment / ManagerDepartment 削除、Position.system_role 削除、各 Doc 型から target_department_ids 削除、employees.department 削除 |
| `components/admin/AttributeTargetSelector.tsx` | 部署タブ削除（施設 + 役職のみ） |
| 12 content pages × admin/mgr/employee | departments query / target_department_ids / employee_departments フィルタ削除 |
| `app/(admin)/admin/employees/[id]/page.tsx` | 「所属グループ」「管理担当グループ」UI セクション削除 |
| `app/(admin)/admin/employees/new/page.tsx` | dept_ids form 削除 |
| `app/(admin)/admin/settings/page.tsx` | 「グループ」設定セクション削除、役職セクションから system_role セレクタ削除 |
| `components/employee/ProfileSection1Basic.tsx` | 「所属グループ」プルダウン削除、`'department'` field type 削除 |
| `components/admin/EmployeeTable.tsx`, `components/manager/SubordinateTable.tsx`, `components/manager/SubordinateDetail.tsx` | dept 列・行削除 |
| `lib/ai-diagnosis-fields.ts`, `lib/manager-visible-fields.ts`, `lib/pdf-fields.ts` | 'department' フィールド削除 |
| `tsconfig.json` | exclude に diletto-shift-maker / diletto-staffbase 追加 |

### 影響範囲
- ❗ **migration 115 未適用**: コード側は dept 参照ゼロ。Supabase で `115_remove_departments_and_position_role.sql` 実行後に dept テーブル drop で完了
- 役職 (positions) は純粋なラベルになる。システム権限は employees.role + manager_facilities + access-matrix で管理

---

## 0.07 週次送迎出力追加分（2026-04-25）

### 新規ファイル
| ファイル | 役割 | 主な参照 |
|---|---|---|
| `components/shift/WeeklyTransportFull.tsx` | 週次送迎印刷ページ本体（A3 縦・1週=1ページ・91行/枚） | admin/mgr weekly-transport |
| `app/(admin)/admin/shifts/output/weekly-transport/page.tsx` | admin ラッパー | - |
| `app/(manager)/mgr/shifts/output/weekly-transport/page.tsx` | manager ラッパー | - |

### 編集ファイル
| ファイル | 変更 |
|---|---|
| `app/(admin)/layout.tsx` | shiftNav に「週次送迎」リンク追加 |
| `app/(manager)/layout.tsx` | 同上 |

### 参照テーブル・カラム
- `employees.{id, tenant_id, facility_id, last_name, first_name, role, default_*, pickup/dropoff_transport_areas, qualifications, is_*, shift_display_order, status}`
- `children.{id, name, display_order, ...}`
- `schedule_entries.{id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, attendance_status}`
- `transport_assignments.{schedule_entry_id, pickup_employee_ids, dropoff_employee_ids, ...}`
- `facility_shift_settings.{pickup_area_labels, dropoff_area_labels}`

### 共通ライブラリ参照（DailyOutputFull と同じ）
- `lib/shift-utils.ts` → staffDisplayName
- `lib/shift-logic/resolveTransportSpec.ts`
- `lib/shift-facility.ts` → useShiftFacilityId
- `lib/types.ts` 各 Row 型

---

## 0.06 タスクD（日次出力）追加分（2026-04-25）

### 新規ファイル
| ファイル | 役割 | 主な参照 |
|---|---|---|
| `lib/date/defaultOutputDate.ts` | 日次出力初期日: 平日→翌日 / 土→月 / 日→月 | DailyOutputFull |
| `components/shift/DailyOutputFull.tsx` | 日次出力ページ本体（ホワイトボード風 A3 縦印刷） | admin/mgr daily |
| `app/(admin)/admin/shifts/output/daily/page.tsx` | DailyOutputFull の admin ラッパー | - |
| `app/(manager)/mgr/shifts/output/daily/page.tsx` | DailyOutputFull の manager ラッパー | - |

### 参照しているテーブル・カラム
- `employees.{id, tenant_id, facility_id, last_name, first_name, role, employment_type, default_start_time, default_end_time, pickup_transport_areas, dropoff_transport_areas, qualifications, is_qualified, is_driver, is_attendant, shift_display_order, status}`
- `children.*`（display_order 含む）
- `schedule_entries.{id, child_id, date, pickup_time, dropoff_time, pickup_method, dropoff_method, attendance_status}`
- `shift_assignments.{employee_id, date, start_time, end_time, assignment_type, segment_order}`（publish_status は **フィルタしない**）
- `transport_assignments.{schedule_entry_id, pickup_employee_ids, dropoff_employee_ids, is_unassigned, is_confirmed}`
- `facility_shift_settings.{pickup_area_labels, dropoff_area_labels}`
- `child_display_order_memory.{slot_signature, child_id, display_order}` (via /api/shifts/transport/child-order)

### 参照している共通ライブラリ
- `lib/shift-utils.ts` → `staffDisplayName`
- `lib/shift-logic/resolveTransportSpec.ts` → `resolveEntryTransportSpec`
- `lib/date/holidays.ts` → `isJpHoliday / jpHolidayName`
- `lib/shift-facility.ts` → `useShiftFacilityId`
- `lib/types.ts` → `StaffRow / ChildRow / ScheduleEntryRow / ShiftAssignmentRow / TransportAssignmentRow / AreaLabel`
- `lib/constants.ts` → `GradeType`

---

## 0.05 編集者表示（ⓑ）対応（2026-04-25）

8ページの SELECT に `editor:employees!updated_by(...)` JOIN 追加 + UI に「編集者: ○○」表示（`created_by !== updated_by` 時のみ）。

| ファイル | JOIN 追加 | UI 追加 |
|---|---|---|
| app/(admin)/admin/announcements/page.tsx | ✅ | ✅ |
| app/(admin)/admin/compliance/page.tsx | ✅ | ✅ |
| app/(admin)/admin/trainings/page.tsx | ✅ | ✅ |
| app/(admin)/admin/manuals/page.tsx | ✅ | ✅ |
| app/(manager)/mgr/announcements/page.tsx | ✅ | 比較条件修正 (object→ID) |
| app/(manager)/mgr/compliance/page.tsx | ✅ | 比較条件修正 |
| app/(manager)/mgr/trainings/page.tsx | ✅ | 比較条件修正 |
| app/(manager)/mgr/manuals/page.tsx | ✅ | 比較条件修正 |

---

## 0.1 タスクA（シフト表）追加分の参照（2026-04-25）

### 新規ファイル
| ファイル | 役割 | 主な参照 |
|---|---|---|
| `lib/types.ts` | 追加: `StaffRow / ShiftRequestRow / ShiftAssignmentRow / ShiftChangeRequestRow / PublishStatus / ShiftAssignmentType / ShiftRequestType / ShiftChangeRequestType / ShiftChangeRequestStatus / ShiftChangeRequestPayload / LegacyNotificationContentType / ShiftNotificationContentType` | 全 shift コンポーネント・API |
| `lib/constants.ts` | 追加: `MAX_STAFF_PER_TRANSPORT / DEFAULT_MIN_QUALIFIED_STAFF / TRANSPORT_TRIP_GAP_MINUTES / PUBLISH_STATUSES` | generateShift / generateTransport (将来) |
| `lib/logic/generateShift.ts` | シフト自動生成ロジック（ルールベース） | ShiftFull |
| `lib/logic/qualifiedCoverage.ts` | カバレッジ計算（コアタイム重複・3名重複時間判定） | ShiftGridFull |
| `lib/date/isToday.ts` | `todayStr()` JST 日付 | ShiftGridFull |
| `lib/date/holidays.ts` | 祝日判定（@holiday-jp/holiday_jp） | ShiftGridFull |
| `lib/auth/shift-api-helpers.ts` | `resolveShiftAuth()` 共通認証 | shift API 群 |
| `lib/email/shift-notification-email.ts` | `buildShiftPublishEmail / buildShiftReadyEmail` | cron/send-notifications |
| `app/api/shifts/transition/route.ts` | publish_status 遷移 + 通知キュー enqueue | ShiftFull |
| `app/api/shifts/shift-change-requests/[id]/route.ts` | 変更申請の承認/却下（admin のみ） | ApprovalQueueFull |
| `components/shift/ShiftFull.tsx` | シフト表ページ本体（admin/manager 共通） | admin/shifts, mgr/shifts |
| `components/shift/ShiftGridFull.tsx` | シフトグリッド（職員×日付） | ShiftFull |
| `components/shift/ApprovalQueueFull.tsx` | 変更申請の承認キュー UI | ShiftFull (admin のみ) |
| `components/shift/MonthStepper.tsx` | 月切替コントロール（URL ?month=YYYY-MM） | ShiftFull |
| `app/(admin)/admin/shifts/page.tsx` | ShiftFull の admin ラッパー | - |
| `app/(manager)/mgr/shifts/page.tsx` | ShiftFull の manager ラッパー | - |

### 編集したファイル
| ファイル | 変更内容 |
|---|---|
| `lib/email/notification-email.ts` | 引数型を `LegacyNotificationContentType` に絞る（5タイプ展開対応） |
| `app/api/cron/send-notifications/route.ts` | `processShiftRow` 追加で shift_ready/shift_publish ディスパッチ |

---

## 1. ロール参照（lib/constants.ts EMPLOYEE_ROLES = ['employee','manager','admin']）

| ファイル | 参照内容 | 備考 |
|---|---|---|
| lib/constants.ts:23 | `EMPLOYEE_ROLES` 定義 | super_admin 削除済 |
| middleware.ts | role別ルーティング `/admin /mgr /my` | DEV_SKIP_AUTH 対応 |
| app/(auth)/login/page.tsx:56 | role別リダイレクト | super_admin 分岐削除済 |
| app/(employee)/layout.tsx:96 | manager/admin で「管理画面へ」表示 | - |
| app/api/admin/send-reminder/route.ts:25 | admin のみ実行可 | - |
| app/api/categories/route.ts:68,146 | admin/manager のみ作成可 | - |
| app/api/employees/invite/route.ts:21 | admin のみ招待可 | - |
| app/api/employees/upload-image/route.ts | admin のみ | - |
| app/api/field-visibility/route.ts | admin のみ | - |
| app/api/notifications/* | role別チェック | - |
| components/admin/EmployeeTable.tsx:44 | role !== 'admin' フィルタ | - |
| components/RoleSwitcher.tsx | super_admin削除に伴いnull返す | Phase 4で再実装予定 |
| supabase/migrations/090_drop_stripe_plan.sql | employees.role CHECK 制約 | - |
| supabase/migrations/101_shift_rls.sql | get_my_role() で admin/manager/employee 判定 | - |

---

## 2. publish_status 参照（draft / ready / published）

| ファイル | 参照内容 | 備考 |
|---|---|---|
| supabase/migrations/100_shift_core.sql | enum publish_status 定義 + shift_assignments + transport_assignments | - |
| supabase/migrations/101_shift_rls.sql | employee の旧 SELECT ポリシー（published のみ） | 107 で上書き |
| supabase/migrations/107_employee_ready_visibility.sql | employee は ready/published どちらも閲覧可（案Z） | - |
| lib/constants.ts | PUBLISH_STATUSES = ['draft','ready','published'] | - |
| lib/types.ts | `PublishStatus` 型 + `ShiftAssignmentRow.publish_status` | - |
| app/api/shifts/transition/route.ts | 遷移ルール（draft↔ready↔published） + 通知キュー enqueue | - |
| components/shift/ShiftFull.tsx | 月集約ステータス表示 + 遷移ボタン群 | - |

---

## 3. facility_id 参照

| ファイル | 参照内容 | 備考 |
|---|---|---|
| supabase/migrations/019_facilities.sql | facilities テーブル + employees.facility_id | staffbase 既存 |
| supabase/migrations/036_facility_scope.sql | announcements/trainings/compliance の target_facility_ids | staffbase 既存 |
| supabase/migrations/100_shift_core.sql | children/schedule_entries/shift_requests/shift_assignments/transport_assignments/shift_change_requests/attendance_audit_logs/child_area_eligible_staff | 全 facility_id 必須 |
| supabase/migrations/101_shift_rls.sql | manager は自 facility_id のみ操作可 | RLS |
| supabase/migrations/103_employees_shift_fields.sql | facility_shift_settings.facility_id | - |
| components/admin/AttributeTargetSelector.tsx | target_type/target_facility_ids UI | - |
| components/admin/FacilityScopeSelector.tsx | applyScopeFilter 関数 | - |

---

## 4. tenant_id 参照

staffbase 既存の全テーブルが対象。`get_my_tenant_id()` PostgreSQL関数で参照。
**重要**: 全 RLS ポリシーで tenant_id チェック必須。新テーブル作成時は必ず追加。

---

## 5. 主要DBテーブル一覧

### staffbase 由来（継承）
| テーブル名 | 主なカラム | facility対応 | 備考 |
|---|---|---|---|
| tenants | id, company_name, representative_name, logo_url | N/A（NPO単一） | Stripe関連削除済（migration 090） |
| facilities | id, tenant_id, name, address | - | 4事業所予定（seed未投入） |
| departments | id, tenant_id, name, display_order | 部門単位 | - |
| positions | id, tenant_id, name, display_order | - | 役職 |
| employees | id, facility_id, role(admin/manager/employee), full_name, last_name, first_name, … | 済 | migration 103 で shift系カラム追加 |
| document_templates | id, tenant_id, type, … | tenant単位 | PDF テンプレ |
| document_submissions | id, employee_id, template_id, form_data | - | - |
| categories | id, tenant_id, type(compliance/training/announcement/manual), name, color, icon | tenant単位 | type に 'manual' 追加（migration 091） |
| compliance_documents | id, tenant_id, title, content, **content_blocks**, category_id, **sort_order**, target_* | facility_scope | sort_order=092、content_blocks=093 |
| compliance_acknowledgments | id, employee_id, doc_id, document_updated_at | - | - |
| trainings | id, tenant_id, title, **body**, **content_blocks**, pdf_storage_path, youtube_url, category_id, **sort_order**, target_* | facility_scope | body=093, content_blocks=093 |
| training_submissions | id, employee_id, training_id, result | - | - |
| announcements | id, tenant_id, title, body, **content_blocks**, category_id, **sort_order**, target_* | facility_scope | sort_order=092, content_blocks=093 |
| announcement_reads | id, announcement_id, employee_id, read_at | - | - |
| manuals | id, tenant_id, title, body, pdf_storage_path, **content_blocks**, category_id, **sort_order**, target_* | facility_scope | 091 で新設、sort_order=092、content_blocks=093 |
| manual_reads | manual_id, employee_id, read_at | - | 091 |
| ai_diagnoses | id, employee_id, type, result | - | - |
| ai_diagnosis_usage | id, tenant_id, year_month, count | - | - |
| notification_queue | id, tenant_id, content_type, content_id, scheduled_at | - | - |
| custom_employee_fields | id, tenant_id, field_key, field_type | - | - |
| field_visibility | employee_id, field_key | - | - |

### shift-maker 由来（migration 100/101/102/103 適用済）
| テーブル名 | 主なカラム | 備考 |
|---|---|---|
| children | id, tenant_id, **facility_id**, name, grade_type, custom_pickup_areas, custom_dropoff_areas | RLS済 |
| schedule_entries | id, tenant_id, **facility_id**, child_id, date, pickup_time, dropoff_time, attendance_status | RPC 経由更新 |
| shift_requests | id, tenant_id, **facility_id**, employee_id, month, request_type, dates[] | - |
| shift_assignments | id, tenant_id, **facility_id**, employee_id, date, start_time, end_time, **publish_status** | enum publish_status |
| transport_assignments | id, tenant_id, **facility_id**, schedule_entry_id, direction, employee_id, **publish_status** | - |
| shift_change_requests | id, tenant_id, **facility_id**, employee_id, change_type, status | - |
| attendance_audit_logs | id, tenant_id, **facility_id**, schedule_entry_id, changed_by_name, old/new_status | RPC で自動記録 |
| child_area_eligible_staff | child_id, area_id, employee_id, direction | - |
| facility_shift_settings | facility_id, min_qualified_staff, pickup/dropoff_area_labels | migration 103 |

### 削除済
| テーブル/カラム | 削除元 |
|---|---|
| tenants.stripe_customer_id, stripe_subscription_status | migration 090 |
| tenants.plan | migration 090 |
| staff（shift-maker） | 作成せず（employees に統合） |

---

## 6. 主要定数参照（lib/constants.ts）

| 定数名 | 場所 | 値 | 参照ファイル |
|---|---|---|---|
| `MAX_DOCUMENTS_PER_TENANT` | lib/constants.ts:4 | 10 | upload系 |
| `MAX_PAYROLL_BANKS_PER_TENANT` | lib/constants.ts:5 | 3 | - |
| `MAX_AI_DIAGNOSIS_PER_MONTH` | lib/constants.ts:6 | 30 | AI 診断 |
| `MAX_DOCX_FILE_SIZE_MB` | lib/constants.ts:7 | 5 | - |
| `TRAINING_SUMMARY_MIN_CHARS` | lib/constants.ts:9 | 300 | training submission |
| `AI_MODEL` | lib/constants.ts:10 | 'claude-haiku-4-5' | AI 診断 API |
| `MAPPING_SOURCE_TYPES` | lib/constants.ts:14 | employee/tenant/form_data/fixed | PDF タグ |
| `INPUT_TYPES` | lib/constants.ts:17 | text/textarea/date/number/select | - |
| `VISIBILITY_CONDITIONS` | lib/constants.ts:20 | all/car_commute_only/shuttle_driver_only | - |
| `GRADE_TYPES`, `GradeType`, `GRADE_LABELS`, `GRADE_GROUPS` | lib/constants.ts | 16種学年区分 + 表示ラベル + タブ用グループ（未就学・幼稚園/小学生/中高生） | ChildrenManager |
| `TRANSPORT_DIRECTIONS`, `TRANSPORT_DIRECTION_LABELS` | lib/constants.ts | pickup/dropoff + 日本語ラベル | 送迎表（Phase 4 Step 5）で使用予定 |
| `EMPLOYEE_ROLES` | lib/constants.ts:23 | employee/manager/admin | 全ロール参照箇所 |
| `EMPLOYEE_STATUS` | lib/constants.ts:26 | active/retired | - |
| `DOCUMENT_STATUS` | lib/constants.ts:29 | draft/submitted/approved | - |
| `TRAINING_RESULT` | lib/constants.ts:32 | pending/passed/failed/resubmit | - |
| `DIAGNOSIS_TYPES` | lib/constants.ts:35 | personality/strengths/culture_fit/team_compat | AI 診断 |
| `MAX_PDF_FILE_SIZE_MB` | lib/constants.ts:41 | 20 | PDF アップロード |
| `FONT_SIZES` | lib/constants.ts:42 | [8,10,12,...,48] | PDF タグ |
| `FONT_FAMILY` | lib/constants.ts:45 | 'Noto Sans JP'（固定） | PDF 描画 |
| `PDF_ASCENT_RATIO` | lib/constants.ts:46 | 0.76 | PDF y座標変換 |
| `PROFILE_SECTION_KEYS` | lib/constants.ts:55 | basic_extended/commute/contacts/intro/work_style/communication/strengths/values/team | プロフィール |

**未実装（Phase 2/4 以降）**:
- `PUBLISH_STATUS` (draft/ready/published) — migration 100 内に enum 定義はあり
- `MAX_STAFF_PER_TRANSPORT`, `DEFAULT_MIN_QUALIFIED_STAFF`, `TRANSPORT_TRIP_GAP_MINUTES`
- `ATTENDANCE_STATUS` (planned/present/absent/late/early_leave)

---

## 7. 主要型参照（lib/types.ts）

| 型名 | 場所 | 主な参照ファイル |
|---|---|---|
| `Tenant` | lib/types.ts:13 | settings/page.tsx 等 |
| `Employee` | lib/types.ts | employees ページ群 |
| `Facility` | lib/types.ts | admin/announcements 等 |
| `Department` | lib/types.ts | AttributeTargetSelector |
| `Position` | lib/types.ts | AttributeTargetSelector |
| `Category` | lib/types.ts:343 | CategoryManager, 4機能 |
| `AreaLabel`, `ChildRow` | lib/types.ts | 児童エリア + 児童レコード型。AreaLabel に address 追加（shift-puzzle 互換） |
| `ChildAreaEligibleStaffRow` | lib/types.ts | 児童専用エリアごとの担当可能職員（child_area_eligible_staff テーブル行） |
| `AttendanceStatus`, `ScheduleEntryRow` | lib/types.ts | 出欠・利用予定レコード型。ScheduleGrid / ScheduleCellEditor で使用 |
| `CategoryType` | lib/types.ts:326 | 'compliance/training/announcement/**manual**' |
| `**ContentBlockJson**` | lib/types.ts:326 | BlockEditor/BlockRenderer ※新規 |
| `**Manual**` | lib/types.ts:328 | 業務マニュアル (admin/mgr/my) |
| `ComplianceDoc` | lib/types.ts:363 | compliance pages |
| `Training` | lib/types.ts:387 | trainings pages（body+content_blocks 追加） |
| `Announcement` | lib/types.ts:415 | announcements pages |
| `AnnouncementRead` | lib/types.ts:430 | - |
| `TargetType` | lib/types.ts | 'all'/'facility' |
| `TagPlacement` | lib/types.ts | PDF テンプレ |

---

## 8. 主要コンポーネント

| コンポーネント | パス | 用途 |
|---|---|---|
| `BlockEditor` | components/admin/BlockEditor.tsx | text/image/video/PDF ブロック編集（admin 4機能で使用） |
| `BlockRenderer` | components/admin/BlockRenderer.tsx | content_blocks の表示（employee 4機能で使用） |
| `NewBadge` | components/admin/NewBadge.tsx | 7日以内作成アイテムに NEW バッジ |
| `ReorderButtons` | components/admin/ReorderButtons.tsx | sort_order 入れ替え（↑↓ボタン） |
| `Breadcrumb` | components/admin/Breadcrumb.tsx | パンくずリスト（admin/mgr/my 全画面） |
| `CategorySelect`, `CategoryBadge` | components/admin/CategorySelect.tsx | カテゴリ選択 + バッジ |
| `CategoryManager` | components/admin/CategoryManager.tsx | カテゴリ CRUD |
| `AttributeTargetSelector`, `TargetAttributeBadges` | components/admin/AttributeTargetSelector.tsx | 配信ターゲット設定（rounded-md に変更済） |
| `FacilityScopeSelector` + `applyScopeFilter` | components/admin/FacilityScopeSelector.tsx | 施設スコープ |
| `RoleSwitcher` | components/RoleSwitcher.tsx | （super_admin 削除につき null 返す。Phase 4 で再実装） |
| `PdfEditor`, `PdfDocumentForm` 等 | components/admin/, components/employee/ | PDF テンプレ系 |
| `ProgressDashboard` | components/admin/ProgressDashboard.tsx | admin ダッシュボード |
| `TrainingPlayer` | components/employee/TrainingPlayer.tsx | レガシー研修動画/PDF再生 |
| `Logo` | components/branding/Logo.tsx | NPOロゴ画像。`size=sm/md/lg`。ロゴ横の企業名テキストは撤去済（3レイアウト共通） |
| `PlaceholderPage` | components/shift/PlaceholderPage.tsx | Phase 4〜7 で実装予定ページ用の共通プレースホルダ（title/icon/description/phase） |
| `ChildrenSettingsFull` | components/shift/ChildrenSettingsFull.tsx | 児童管理（shift-puzzle 1031行を忠実移植、scope prop） |
| `[旧] ChildrenManager` | components/shift/ChildrenManager.tsx | 簡略版。ChildrenSettingsFull で置換済み（残置） |
| `[旧] AreaEditor` | components/shift/AreaEditor.tsx | 簡略版エリア編集。ChildrenSettingsFull は内部に CustomAreasEditor を持つ |
| `shift-compat/Modal` | components/shift-compat/Modal.tsx | shift-puzzle Modal の API そのまま（size: sm/md/lg/xl + title） |
| `shift-compat/Button` | components/shift-compat/Button.tsx | shift-puzzle Button の API そのまま（primary/secondary/cta-submit/app-card-cta） |
| `shift-compat/Badge` | components/shift-compat/Badge.tsx | shift-puzzle Badge の API そのまま（success/warning/error/info/neutral） |
| `lib/shift-utils.ts` | staffDisplayName / parseChildName / GRADE_LABELS 再 export |
| `ScheduleGrid` | components/shift/ScheduleGrid.tsx | 利用予定グリッド（児童×日）。月ステッパー + 事業所フィルタ。admin/manager 共通、scope prop |
| `ScheduleCellEditor` | components/shift/ScheduleCellEditor.tsx | セル編集ダイアログ（利用/迎え/送り/エリア） |
| `ReorderButtons` | components/admin/ReorderButtons.tsx | 並び替え（↑↓）。対応テーブル: compliance_documents/trainings/announcements/manuals（sort_order）+ **children**（display_order） |

---

## 14. サイドバー2モード構成（admin / manager）

admin / manager レイアウトは **社員モード** と **シフトモード** の 2 モードを持ち、右下フローティングボタンで切替。

### モード判定ロジック
- `localStorage['admin-mode']` / `localStorage['mgr-mode']` に `'staff'` / `'shift'` を永続化
- URL prefix で強制判定:
  - admin: `/admin/children/*`, `/admin/shifts/*`（dashboard/schedule/transport）→ shift
  - admin: `/admin/employees/*`, `/documents/*`, `/compliance/*`, `/trainings/*`, `/announcements/*`, `/manuals/*`, `/team-diagnosis/*`, `/settings/*`, `/dashboard` → staff
  - mgr: 同様パターン
  - **共有URL**（`/admin/shifts`, `/admin/requests`, `/mgr/shifts`, `/mgr/requests`）はモード据え置き（localStorage値を採用）

### admin 社員モード navItems
- ダッシュボード (`/admin/dashboard`) / 社員管理 / 書類テンプレ / 遵守事項 / 研修 / お知らせ / 業務マニュアル / チーム診断 / 設定
- ※ シフト表・休み希望はシフトモードからのみアクセス（社員モードからは除外）

### admin シフトモード navItems
- ダッシュボード (`/admin/shifts/dashboard`) / 利用予定 / シフト表 / 送迎表 / 休み希望 / **⚙️ シフト設定アコーディオン**（事業所設定 / 職員管理 / 児童管理）
- 作業順序に沿った並び（shift-puzzle と一致）

### mgr 社員モード navItems
- ダッシュボード / 部下管理 / 遵守事項 / 研修 / お知らせ / 業務マニュアル
- ※ シフト表・休み希望はシフトモードからのみアクセス

### mgr シフトモード navItems
- ダッシュボード (`/mgr/shifts/dashboard`) / 利用予定 / シフト表 / 送迎表 / 休み希望 / **⚙️ シフト設定アコーディオン**（事業所設定 / 職員管理 / 児童管理）

### employee タブ（layout 上部）
- ホーム / 基本情報 / 自己紹介 / 書類 / 遵守事項 / 研修 / お知らせ / 業務マニュアル / **休み希望**（新規追加）

### シフト系新規ページ（プレースホルダで導線のみ用意済）
- admin: `/admin/children`, `/admin/shifts`, `/admin/shifts/dashboard`, `/admin/shifts/schedule`, `/admin/shifts/transport`, `/admin/requests`
- mgr: `/mgr/children`, `/mgr/shifts`, `/mgr/shifts/dashboard`, `/mgr/shifts/schedule`, `/mgr/shifts/transport`, `/mgr/requests`
- my: `/my/requests`, `/my/shifts`

### Breadcrumb ラベル追加
- `components/admin/Breadcrumb.tsx` の `LABELS` に上記 14 ルートを追記済

---

## 9. ヘルパー / ライブラリ

| 名前 | パス | 用途 |
|---|---|---|
| `nextSortOrder` | lib/sort-helpers.ts | MAX(sort_order)+1 算出（カラム未存在時 null） |
| `sanitizeFilename`, `buildStoragePath` | lib/upload-helpers.ts | 日本語ファイル名対応 + Storage パス生成 |
| `enqueueNotification` | lib/notifications/queue.ts | 通知キュー |
| `createClient` (browser/server) | lib/supabase/client.ts, server.ts | Supabase クライアント |

---

## 10. APIルート一覧

| ルート | メソッド | ロール要件 | 備考 |
|---|---|---|---|
| `/api/auth/register` | POST | 公開 | テナント作成 + admin社員 |
| `/api/categories` | GET/POST/PATCH | GET:全/書込:admin,manager | type=compliance/training/announcement/manual |
| `/api/employees/invite` | POST | admin | 招待メール |
| `/api/employees/resend-invite` | POST | admin | - |
| `/api/employees/upload-image` | POST | admin | - |
| `/api/admin/send-reminder` | POST | admin | リマインダーメール |
| `/api/documents/upload-pdf` | POST | admin | テンプレPDF |
| `/api/documents/save-placements` | POST | admin | タグ配置 |
| `/api/documents/generate-pdf` | POST | - | 差し込み生成 |
| `/api/documents/bulk-pdf-zip` | POST | - | 一括ZIP |
| `/api/documents/bulk-pdf-zip-employee` | POST | admin | - |
| `/api/custom-fields` | CRUD | admin | - |
| `/api/field-visibility` | POST | admin | - |
| `/api/ai/{personality,strengths,culture-fit,team-compat}` | POST | - | AI 診断 |
| `/api/notifications/enqueue` | POST | - | 通知投入 |
| `/api/notifications/cancel` | POST | - | - |
| `/api/notifications/manager-action` | POST | manager | - |
| `/api/email/training-result` | POST | admin/manager | - |

**削除済**: `/api/stripe/*`, `/api/webhooks/stripe`, `/api/documents/copy-samples`（super_admin専用）

---

## 11. 連動ポイント早見表

| 変更箇所 | 確認必須ファイル |
|---|---|
| `lib/constants.ts` | middleware.ts + 全参照ファイル + 本ファイル §6 |
| `lib/types.ts` の型変更 | 該当型を使う全ファイル + 本ファイル §7 |
| `EMPLOYEE_ROLES` 変更 | 全APIロールチェック + middleware.ts + 本ファイル §1 |
| `publish_status` 変更 | shift/transport API + ShiftGrid + RLS + 本ファイル §2 |
| `facility_id` 追加 | 該当テーブル RLS + 本ファイル §3 |
| `categories.type` 追加 | api/categories VALID_TYPES + admin/categories タブ + admin/settings タブ + types.ts CategoryType |
| `content_blocks` 構造変更 | BlockEditor + BlockRenderer + types.ts ContentBlockJson |
| `sort_order` 関連 | nextSortOrder + ReorderButtons + 4テーブルの list query |
| Storage アップロード | sanitizeFilename + buildStoragePath（日本語ファイル名対応） |

---

## 12. CategoryType 'manual' 参照（業務マニュアル機能の連動）

| ファイル | 参照内容 |
|---|---|
| lib/types.ts:326 | `CategoryType` union に 'manual' |
| app/api/categories/route.ts:5 | VALID_TYPES に 'manual' |
| app/(admin)/admin/categories/page.tsx | TABS に '業務マニュアル' |
| app/(admin)/admin/settings/page.tsx | カテゴリ管理タブに '業務マニュアル' |
| app/(admin)/admin/manuals/page.tsx | カテゴリフェッチ `?type=manual` |
| app/(manager)/mgr/manuals/page.tsx | 同上 |
| app/(employee)/my/manuals/page.tsx | 同上 |
| supabase/migrations/091_manuals.sql | categories.type CHECK 制約に 'manual' |

---

## 13. ContentBlock 参照（ブロックエディタ連動）

| ファイル | 参照内容 |
|---|---|
| lib/types.ts | `ContentBlockJson` union 定義 |
| components/admin/BlockEditor.tsx | `ContentBlock` 型 + 編集UI |
| components/admin/BlockRenderer.tsx | 表示 + YouTube/Drive 埋込 URL 変換 |
| app/(admin)/admin/{compliance,trainings,announcements,manuals}/page.tsx | BlockEditor 使用、`content_blocks` に保存 |
| app/(employee)/my/{compliance,trainings,announcements,manuals}/page.tsx | BlockRenderer 使用、`content_blocks` 表示 |
| supabase/migrations/093_content_blocks.sql | 4テーブルに content_blocks jsonb |
| app/(manager)/mgr/{compliance,trainings,announcements,manuals}/page.tsx | BlockEditor 適用済（案B: target_type='facility' + 自担当facility、admin と機能同等） |

### 旧データ互換（重要）
- **compliance**: 既存の `content`（プレーンテキスト）しか持たないドキュメントを編集する際、`openEdit` で `content_blocks` が空なら `[{type:'text', value: content}]` として seed。保存時に `content_blocks` に取り込まれる。
  - 適用箇所: `app/(admin)/admin/compliance/page.tsx` `openEdit()`, `app/(manager)/mgr/compliance/page.tsx` `openEdit()`

---

## 14. AttendanceStatus / waitlist_order 参照（Phase 64 / migration 124）

| ファイル | 参照内容 |
|---|---|
| supabase/migrations/100_shift_core.sql | `schedule_entries.attendance_status` 元定義 |
| supabase/migrations/102_shift_rpcs.sql | `update_schedule_entry_attendance(uuid, text)` 旧 2 引数版（migration 124 で drop & 再定義） |
| supabase/migrations/105_schedule_entries_methods.sql | CHECK に 'leave' 追加 |
| **supabase/migrations/124_attendance_waitlist.sql** | **CHECK に 'waitlist' 追加 / `waitlist_order smallint` 列追加（範囲 1-10、status='waitlist' 以外で NULL 強制）/ RPC を `(uuid, text, smallint default null)` で再定義** |
| lib/types.ts | `AttendanceStatus` union に 'waitlist' / `ScheduleEntryRow.waitlist_order: number \| null` |
| components/shift/ScheduleFull.tsx | RPC 呼び出しに `p_waitlist_order` 追加、4 ボタン + 5×2 順番ピッカー + 注意書き、`waitlist_order` state 管理、carry-over（waitlist→他→waitlist で番号復元） |
| components/shift/ScheduleGridFull.tsx | セル「キャ待 ①」表示、利用数行の下にキャンセル待ち件数行、`hasAnyWaitlist` で行を出し分け |
| components/shift/TransportFull.tsx | 通常テーブルから waitlist 除外、`currentDayWaitlist` memo + 集約バー + 「利用に変える」確認モーダル、ヘッダ「⏳ 待 N人」バッジ、generate 入力から除外、staff area marks ループから除外 |
| components/shift/ShiftFull.tsx | `childrenCountByDate` から waitlist 除外、新規 `childrenWaitlistCountByDate` |
| components/shift/ShiftGridFull.tsx | 日付ヘッダに「待 N」バッジ |
| lib/logic/generateShift.ts | `dailyChildCount` 集計から waitlist 除外（必要職員数の過剰見積もり防止） |
| components/shift/DailyOutputFull.tsx | `slots` 構築から waitlist 除外、`activeChildCount` から除外、`waitlistChildren` memo + 右カラム「キャンセル待ち」セクション（旧「休憩」セクション置換）、ヘッダに「キャンセル待ち N 名」併記 |
| components/shift/WeeklyTransportFull.tsx | フィルタに waitlist 除外を追加 |
| components/shift/DailyReportFull.tsx | `attendanceLabel` の case に 'waitlist' → '待' 追加 |

### 設計判断
- **uniq 制約なし**: 兄弟で同日 ① が 2 人ありえるため、`(date, waitlist_order)` の uniq は付けない
- **CHECK 2 つ**: `waitlist_order between 1 and 10` と `waitlist_order != NULL → status = 'waitlist'`
- **RPC 後方互換**: 第 3 引数 `p_waitlist_order smallint default null` で既存 2 引数呼び出しはそのまま動く
- **status 変更時のみ audit log 記録**: 順番だけの変更で `attendance_audit_logs` を膨らませない
- **employee 側の影響**: `(employee)/my/shifts` は publish 済みシフトのみ閲覧で利用予定 (`schedule_entries`) を直接参照しないため waitlist の影響を受けない

---

## 14b. `get_facility_members` / `get_facility_member_ids` RPC — shift_manager / manager の職員一覧取得（migration 154, 155, 2026-05-07）

**送迎表で他職員が見えない問題の修正。** `lib/multi-facility.ts` の `fetchFacilityMemberIds` / `fetchEmployeeIdsForFacilities` が `employees` を直接 SELECT していたが、employees の RLS は migration 010 で「自分のみ」「admin のみ tenant 全件」しか定義されておらず、manager / shift_manager は自分 1 件しか取れなかった（migration 144 で許可しようとしたが「全員ログアウト」発生で 145 ロールバック済）。

**ID リスト（migration 154）だけでは不十分**だった点に注意: 取得後に `from('employees').select(...).in('id', ids)` を呼ぶと employees の RLS が再び効いて結局自分の行しか返らない。**行データ全体を返す `get_facility_members`（migration 155）** を新設し、各画面のクエリを RPC 1 本に置換した。

| ファイル | 参照内容 |
|---|---|
| supabase/migrations/154_get_facility_member_ids_rpc.sql | `get_facility_member_ids(p_facility_id uuid)` SECURITY DEFINER RPC（id 配列のみ）。assignments の結合キー判定など ID だけで足りる用途に残置 |
| **supabase/migrations/155_get_facility_members_rpc.sql** | **`get_facility_members(p_facility_id uuid)` SECURITY DEFINER RPC。id, tenant_id, facility_id, employee_number, last_name, first_name, email, role, status, employment_type, default_start/end_time, pickup/dropoff_transport_areas, qualifications, shift_qualifications, is_qualified/driver/attendant, shift_display_order, join_date, employee_position を返す（住所・電話・birth_date・銀行・保険番号は含めない）** |
| lib/multi-facility.ts | `fetchFacilityMembers(supabase, facility_id): FacilityMemberRow[]` 追加 / `fetchFacilityMemberIds` は注意書きとともに残置（ID だけで足りる用途専用） |
| components/shift/StaffSettingsFull.tsx | 職員一覧 SELECT を `fetchFacilityMembers` に置換 |
| components/shift/TransportFull.tsx | empRes Promise.all から外し、`fetchFacilityMembers` で先に取って StaffRow projection |
| components/shift/ShiftFull.tsx | 同上 |
| components/shift/WeeklyTransportFull.tsx | 同上 |
| components/shift/DailyOutputFull.tsx | 同上 |
| components/shift/DailyReportFull.tsx | 同上 |
| components/shift/StaffChildOverlapView.tsx | 同上（StaffCol projection） |
| components/shift/AdminRequestsView.tsx | 同上（EmployeeRow projection、memberIds は shift_requests 絞り込みに引き続き使用） |

### 設計判断
- **RLS は触らない**: migration 144 ロールバックの教訓（再帰的 RLS 評価で全員ログアウト）から、SECURITY DEFINER RPC で必要最小限のフィールドだけ返す方式に統一（migration 146 `get_my_subordinates` と同じ設計）
- **manager / shift_manager の認可**: `get_my_managed_facility_ids()` 経由で「自分の管轄 facility か」だけチェック。employee ロールには空配列を返す
- **同テナントチェック**: `facilities.tenant_id` を直接照合
- **戻り値カラム**: シフト・送迎・職員管理 UI で必要な列のみ。住所・電話・banking 等の機密情報は含めない
- **`position` は予約語**: 戻り値カラム名は `employee_position` に変更（migration 146 と同じ手法）
- **`distinct on (e.id)`**: 主所属 + 兼任を employee_facilities LEFT JOIN で union するときに重複を避ける

---

## 14a. 出席判定ヘルパー `isAttended` / `isWaitlist`（Phase 66-E, 2026-05-07）

**料金表で「利用していないのに料金発生」が起きた → 各箇所で出席判定ロジックがコピペされ微妙にズレていたため一元化。**

| ファイル | 参照内容 |
|---|---|
| **lib/logic/attendance.ts** | **`isAttended(e)` = 「pickup_time or dropoff_time が入っている」AND「status !== 'waitlist'」/ `isWaitlist(e)` = 「status === 'waitlist'」** |
| components/shift/BillingFull.tsx | 出席日数 + イベント参加初期値 → `isAttended` 一括 |
| components/shift/DailyOutputFull.tsx | 送迎スロット組立て + `activeChildCount` → `isAttended` |
| components/shift/ShiftFull.tsx | `childrenCountByDate`（必要職員数算定） → `isAttended` |
| components/shift/WeeklyTransportFull.tsx | scheduleEntries フィルタ → `isAttended` |
| components/shift/TransportFull.tsx | scheduleEntries フィルタ → `isAttended ∪ isWaitlist`（送迎表は集約バー用に waitlist も保持）/ 当日利用人数 → `isAttended` / 当日キャンセル待ち → `isWaitlist` / 送迎スロット組立て → `isAttended` |
| components/shift/StaffChildOverlapView.tsx | 児童 × 職員同席日数 → `isAttended` |
| lib/logic/generateShift.ts | `dailyChildCount` 集計 → `isAttended` |

### 設計判断
- **時間 NULL の planned/present は非カウント**: 旧コードは `attendance_status NOT IN ('absent','leave','waitlist')` だけで判定する箇所もあったが、新ロジックでは時間 NULL の planned エントリ（attendance status だけ作られた空セル）は**全て非カウント**に統一
- **absent / leave の status 明示除外を廃止**: UI で absent / leave を選ぶと `pickup_time` / `dropoff_time` が NULL に強制される（ScheduleFull.tsx handleSave）ため、時間チェックだけで自動的にカウント外になる。status による明示除外はノイズだったので削除
- **waitlist のみ status で除外**: waitlist は present 昇格時に時刻を引き継ぐため時刻を保持する設計（migration 124）。なので時間チェックだけでは除外できず、status で明示除外する
- **送迎表のみ `isAttended ∪ isWaitlist`**: キャンセル待ちセクション表示用に scheduleEntries は両方保持。出席判定が必要な内部ロジックでは `isAttended` だけを使う

---

## 14b. facilities フィーチャーフラグ（shift_enabled / transport_enabled / shift_only_mode）

| ファイル | 参照内容 |
|---|---|
| supabase/migrations/116_facility_core_time_and_meta.sql | `facilities.shift_enabled` / `transport_enabled` 列追加 |
| **supabase/migrations/125_facility_shift_only_mode.sql** | **`facilities.shift_only_mode boolean default false` 列追加。シフトのみモード判定用** |
| lib/types.ts | `Facility.shift_only_mode?: boolean` |
| app/(admin)/layout.tsx | facility SELECT に `shift_only_mode` 追加 / `shiftOnlyMode` useMemo / `SidebarNav` で 4 項目フィルタ（ダッシュボード / シフト表 / 休み希望 / 職員管理） |
| app/(manager)/layout.tsx | `FacilityLite` に `transport_enabled` / `shift_only_mode` 追加 / 同様の useMemo + SidebarNav フィルタ |
| app/(admin)/admin/settings/page.tsx | facility CRUD に `shift_only_mode` 追加 / `FacilityRowItem` に「シフトのみ」トグル追加 |

### sidebar フィルタ仕様
- `shift_only_mode=true`: シフト系の 4 項目のみ表示。利用表 / 送迎表 / 日次出力 / 業務日報 / 事業所設定 / 児童管理 を sidebar から除外
- `shift_only_mode=false` かつ `transport_enabled=false`: 送迎表のみ除外（migration 116 動作）
- 両方 false / true: フル sidebar
- フラグは事業所単位で独立。事業所セレクタで切り替えると即座に sidebar 再フィルタ

### シフト生成ガード（mobile-responsiveness ブランチで変更）
- `components/shift/ShiftFull.tsx` のシフト生成ボタンは **`staff.length === 0` のみ** で disabled 判定する。
- 旧仕様（`!shiftOnlyMode && scheduleEntries.length === 0` で利用予定 0 件なら disabled）は撤廃。`generateShiftAssignments` は利用予定 0 件でも各日最低 3 名で正常生成できるため、全事業所で利用予定未登録のままシフト生成可能。
- これに伴い ShiftFull.tsx は `facilities.shift_only_mode` を **参照しない**（旧: 生成可否判定のため fetch していた）。`shift_only_mode` は sidebar フィルタ専用フラグになった。

---

## 14c. 利用料金表 / イベント / 児童料金属性（Phase 66, migration 126〜128）

| ファイル | 参照内容 |
|---|---|
| **supabase/migrations/126_children_billing_fields.sql** | children に `municipality / copay_tier / copay_freeform_amount / kumon_monthly_fee` 列追加 |
| **supabase/migrations/127_events.sql** | `events` テーブル新規（name, date, price, facility_id）+ RLS |
| **supabase/migrations/128_billing.sql** | `billing_summaries` + `billing_event_participations` 新規 + RLS |
| lib/types.ts | `CopayTier` / `EventRow` 追加、`ChildRow` 拡張 |
| lib/constants.ts | `SNACK_FEE_PER_DAY=50` / `COPAY_TIERS` / `COPAY_TIER_AMOUNT` / `COPAY_TIER_LABELS` / `NAGOYA_FREE_PRESCHOOL_MUNICIPALITY` / `FREE_GRADES_NATIONWIDE` |
| lib/logic/computeBilling.ts | `isFreeOfCharge` / `resolveCopayCap` / `computeDefaultCopayAmount` / `computeBillingRow`（純関数） |
| components/shift/ChildrenSettingsFull.tsx | 児童編集モーダルに料金属性 UI、児童一覧テーブルに「上限 / 公文」列追加（事業所列削除）|
| components/shift/EventSettingsFull.tsx | イベント設定 ページ（CRUD + 月切替）|
| components/shift/BillingFull.tsx | 利用料金表 ページ（月選択 / 自動計算 / 手動オーバーライド / 保存 / A4 横印刷）|
| app/(admin)/admin/shifts/events/, app/(manager)/mgr/shifts/events/ | EventSettingsFull のページラッパ |
| app/(admin)/admin/shifts/output/billing/, app/(manager)/mgr/shifts/output/billing/ | BillingFull のページラッパ |
| app/(admin)/layout.tsx, app/(manager)/layout.tsx | サイドバーに「💰 利用料金表」追加 / 「⚙️ シフト設定」をアコーディオン化 |
| app/(admin)/admin/shifts/dashboard/page.tsx, app/(manager)/mgr/shifts/dashboard/page.tsx | ダッシュボードカードを 11 枚に拡張（業務日報・利用料金表・事業所設定・職員管理・児童管理・イベント設定 を追加、旧「設定」削除） |

### 設計判断
- **1日単価カラムは持たない**: 受給者証ベースの精緻な利用負担額計算はデイロボに任せ、月次料金表ページで手動オーバーライド。child 属性として持たない
- **公文代は児童ごとの自由入力**: `kumon_monthly_fee integer null`。施設・児童で金額が違うため固定定数化しない（null = 計上しない）
- **無償化判定**: 全国 = `nursery_3/4/5`、名古屋市のみ追加で `preschool` も対象（市町村文字列の完全一致）
- **イベント参加判定**: 月締め時に手動チェック前提。schedule_entries の `attendance_status='present'` から自動推測はしない（present 以外でも イベントには参加した、という運用例があるため）
- **月次集計の永続化**: `billing_summaries` に snapshot 保存。再印刷時に同じ数字が出る（月内に児童属性が変わっても紙の数字は守られる）
- **shift_only_mode との関係**: シフトのみ事業所はそもそも利用料金表を使わない（児童不在）。サイドバーから 利用料金表 / 児童管理 / イベント設定 はフィルタで除外

---

## 15. employees 必須カラム（保存時クライアント側バリデーション）

| ファイル | 参照内容 |
|---|---|
| supabase/migrations/010_rls.sql | employees の RLS（admin/super_admin は UPDATE 可） |
| **app/(admin)/admin/employees/[id]/page.tsx** | **`REQUIRED_BASIC_KEYS` で `last_name / first_name / last_name_kana / first_name_kana` を空文字 → null 化禁止。`saveBasicEdit` で送信前にトーストブロック** |

理由: `employees.{last_name, first_name, last_name_kana, first_name_kana}` はすべて NOT NULL。フォームの「空文字 → null 一括変換」を素通しすると `null value in column "last_name" violates not-null constraint` で保存失敗する。フロントで空文字ブロックする。
